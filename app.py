from flask import Flask, render_template, request, jsonify
import folium
import requests
import logging
import time
import threading
from haversine import haversine
import polyline
import numpy as np

app = Flask(__name__)

# Configure logging
logging.basicConfig(filename='app.log', level=logging.INFO,
                   format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# API endpoints
OSRM_API = 'http://router.project-osrm.org'
NOMINATIM_API = 'https://nominatim.openstreetmap.org/search'
SERVER_JS_URL = 'http://192.168.39.185:3000'

# Headers for Nominatim
NOMINATIM_HEADERS = {
    'User-Agent': 'EmergencyVehicleNavigation/1.0 (hi@g.c)',
    'Accept': 'application/json'
}

# Store vehicle location and traffic signals
vehicle_location = {'latitude': None, 'longitude': None}
traffic_signals = []
route_points = []
nearest_signal_info = {'nearestSignal': None, 'distance': None}

def geocode_location(query):
    try:
        response = requests.get(NOMINATIM_API, 
                              params={'q': query, 'format': 'json', 'limit': 1},
                              headers=NOMINATIM_HEADERS,
                              timeout=10)
        response.raise_for_status()
        data = response.json()
        if not data:
            logger.error(f"No geocoding results for: {query}")
            return None
        logger.info(f"Geocoded {query} to {data[0]['lat']}, {data[0]['lon']}")
        return (float(data[0]['lat']), float(data[0]['lon']))
    except requests.RequestException as e:
        logger.error(f"Geocoding failed for {query}: {str(e)}")
        return None

def detect_intersections(route):
    """Heuristic to detect main intersections based on route curvature"""
    points = np.array(route)
    signals = []
    step = max(1, len(route) // 10)  # Aim for ~10 signals
    
    for i in range(0, len(points) - step, step):
        prev = points[i - step] if i >= step else points[0]
        curr = points[i]
        next_point = points[i + step]
        
        vec1 = curr - prev
        vec2 = next_point - curr
        
        cos_angle = np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2) + 1e-6)
        angle = np.arccos(np.clip(cos_angle, -1, 1)) * 180 / np.pi
        
        if angle > 30 or i == 0 or i + step >= len(points) - 1:
            signals.append({'latitude': float(curr[0]), 'longitude': float(curr[1])})
    
    return signals

def simulate_vehicle_movement(start_coords, end_coords):
    global vehicle_location, route_points, nearest_signal_info, traffic_signals
    route_url = f"{OSRM_API}/route/v1/driving/{start_coords[1]},{start_coords[0]};{end_coords[1]},{end_coords[0]}?overview=full"
    try:
        response = requests.get(route_url, timeout=10).json()
        if response.get('code') != 'Ok':
            logger.error(f"OSRM route error: {response.get('message')}")
            return
    except requests.RequestException as e:
        logger.error(f"OSRM request failed: {e}")
        return
    
    route_points = polyline.decode(response['routes'][0]['geometry'])
    traffic_signals = detect_intersections(route_points)
    vehicle_location = {'latitude': route_points[0][0], 'longitude': route_points[0][1]}
    
    for signal in traffic_signals:
        try:
            requests.post(f'{SERVER_JS_URL}/gps-data', json=signal, timeout=10)
            logger.info(f"Traffic signal sent: {signal}")
        except requests.RequestException as e:
            logger.error(f"Failed to send traffic signal data: {str(e)}")
    
    for i in range(len(route_points) - 1):
        current_pos = list(route_points[i])
        target = route_points[i + 1]
        
        while haversine(current_pos, target) > 0.01:
            lat_diff = (target[0] - current_pos[0]) * 0.05
            lng_diff = (target[1] - current_pos[1]) * 0.05
            
            current_pos[0] += lat_diff
            current_pos[1] += lng_diff
            
            vehicle_location['latitude'] = current_pos[0]
            vehicle_location['longitude'] = current_pos[1]
            
            try:
                response = requests.post(f'{SERVER_JS_URL}/update-ambulance', 
                                      json={
                                          'latitude': current_pos[0],
                                          'longitude': current_pos[1],
                                          'route': route_points
                                      }, timeout=10).json()
                nearest_signal_info = {
                    'nearestSignal': response['nearestSignal'],
                    'distance': response['distanceToNearest']
                }
            except requests.RequestException as e:
                logger.error(f"Failed to update ambulance: {str(e)}")
                nearest_signal_info = {'nearestSignal': None, 'distance': None}
                
            time.sleep(0.1)

@app.route('/')
def index():
    logger.info("Rendering index page")
    return render_template('index.html')

@app.route('/plan_route', methods=['POST'])
def plan_route():
    global traffic_signals, route_points
    
    start = request.form['start']
    end = request.form['end']
    
    logger.info(f"Route planning requested: {start} to {end}")
    
    start_coords = geocode_location(start)
    if not start_coords:
        return jsonify({'error': f'Failed to geocode start location: {start}'}), 400
        
    end_coords = geocode_location(end)
    if not end_coords:
        return jsonify({'error': f'Failed to geocode end location: {end}'}), 400
    
    route_url = f"{OSRM_API}/route/v1/driving/{start_coords[1]},{start_coords[0]};{end_coords[1]},{end_coords[0]}?overview=full"
    try:
        route_response = requests.get(route_url, timeout=10).json()
        if route_response.get('code') != 'Ok':
            logger.error(f"OSRM route error: {route_response.get('message')}")
            return jsonify({'error': 'Failed to calculate route'}), 400
    except requests.RequestException as e:
        logger.error(f"Route request failed: {e}")
        return jsonify({'error': 'Failed to get route from OSRM'}), 500
    
    route_points = polyline.decode(route_response['routes'][0]['geometry'])
    traffic_signals = detect_intersections(route_points)
    
    for signal in traffic_signals:
        try:
            requests.post(f'{SERVER_JS_URL}/gps-data', json=signal, timeout=10)
            logger.info(f"Traffic signal sent: {signal}")
        except requests.RequestException as e:
            logger.error(f"Failed to send traffic signal data: {str(e)}")
    
    threading.Thread(target=simulate_vehicle_movement,
                    args=(start_coords, end_coords),
                    daemon=True).start()
    
    return jsonify({
        'start': start_coords,
        'route': route_points,
        'signals': traffic_signals
    })

@app.route('/get_vehicle_location')
def get_vehicle_location():
    global nearest_signal_info
    logger.info("Vehicle location requested")
    return jsonify({
        'location': vehicle_location,
        'nearestSignal': nearest_signal_info['nearestSignal'],
        'distanceToNearest': nearest_signal_info['distance'],
        'ambulanceColor': 'black'  # Added to change ambulance color
    })

if __name__ == '__main__':
    logger.info("Starting Flask server on port 5000")
    app.run(host='0.0.0.0', port=5000, debug=True)