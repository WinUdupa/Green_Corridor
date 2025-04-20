# Green Corridor

## Overview
Green Corridor is an innovative web application designed to optimize emergency vehicle travel by coordinating traffic signals to create a seamless "green corridor." By integrating real-time tracking and dynamic traffic management, this project aims to reduce response times for ambulances and other emergency services, potentially saving lives.

## Features
- **Real-Time Location Tracking**: Monitors emergency vehicle positions using geolocation data for precise navigation.
- **Emergency Route Detection**: Calculates the fastest route to the destination, factoring in traffic conditions.
- **Dynamic Traffic Signal Control**: Interfaces with traffic systems to prioritize green lights along the vehicle’s path.
- **Simulation Dashboard**: Allows users to simulate ambulance movement and visualize route optimization.

## Technologies Used
- **JavaScript**: Drives front-end interactivity and real-time updates.
- **Node.js**: Manages server-side logic and API integrations.
- **Google Maps API**: Provides route calculation and map visualization.
- **HTML5/CSS3**: Structures and styles the responsive web interface.

## Getting Started

### Prerequisites
- Node.js (v16 or higher) and npm installed.
- A modern web browser (e.g., Chrome, Firefox, Safari).
- A Google Maps API key for mapping functionality.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/WinUdupa/Green-Corridor.git
   ```
2. Navigate to the project directory:
   ```bash
   cd Green-Corridor
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file and add your Google Maps API key:
   ```env
   GOOGLE_MAPS_API_KEY=your_api_key_here
   ```
5. Start the application:
   ```bash
   npm start
   ```

## Usage
1. Open your browser and navigate to `http://localhost:3000`.
2. Use the simulation dashboard to initiate an ambulance’s journey.
3. Observe real-time route updates and traffic signal adjustments.
4. Test different scenarios to evaluate the green corridor’s efficiency.

