const express = require('express');
const Web3 = require('web3');
const haversine = require('haversine');
const axios = require('axios');
const app = express();
app.use(express.json());

const web3 = new Web3('http://192.168.39.185:7545');
const contractAddress = '0xd753029F0D64931d747c166C0611EaBD1bC48F16';
const contractABI = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "enum TrafficLightControl.LightState",
        "name": "newState",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "distance",
        "type": "uint256"
      }
    ],
    "name": "StateChanged",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "currentState",
    "outputs": [
      {
        "internalType": "enum TrafficLightControl.LightState",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function",
    "constant": true
  },
  {
    "inputs": [],
    "name": "distanceThreshold",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function",
    "constant": true
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function",
    "constant": true
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_threshold",
        "type": "uint256"
      }
    ],
    "name": "setDistanceThreshold",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_distance",
        "type": "uint256"
      }
    ],
    "name": "updateTrafficLight",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCurrentState",
    "outputs": [
      {
        "internalType": "enum TrafficLightControl.LightState",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function",
    "constant": true
  }
];
const contract = new web3.eth.Contract(contractABI, contractAddress);

const receiverEsp32Url = 'http://192.168.39.106/update-light';
const senderAccount = '0xcac05739c5837D6d00298006F816dFeB54407445';

const trafficLightStates = new Map();
let ambulanceLocation = { latitude: 12.9300, longitude: 77.5800 };
let trafficSignals = [];

app.post('/gps-data', async (req, res) => {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
        console.log('Invalid GPS data:', req.body);
        return res.status(400).json({ error: 'Invalid GPS data' });
    }

    try {
        const trafficLightLocation = { latitude, longitude };
        const trafficLightKey = `${latitude},${longitude}`;
        if (!trafficSignals.some(s => s.latitude === latitude && s.longitude === longitude)) {
            trafficSignals.push(trafficLightLocation);
        }
        
        const distance = haversine(ambulanceLocation, trafficLightLocation, { unit: 'meter' });
        console.log(`Processing GPS data - Distance to (${trafficLightKey}): ${distance}m`);

        const gasPrice = await web3.eth.getGasPrice();
        const receipt = await contract.methods.updateTrafficLight(Math.floor(distance))
            .send({ from: senderAccount, gas: 1000000, gasPrice });
        console.log('Contract updated:', receipt.transactionHash);

        const currentState = 0;  // All signals start red
        trafficLightStates.set(trafficLightKey, currentState);
        console.log(`State updated (${trafficLightKey}): ${currentState}`);

        try {
            await axios.post(receiverEsp32Url, { 
                state: currentState,
                latitude,
                longitude
            });
            console.log('ESP32 notified:', trafficLightKey);
        } catch (receiverError) {
            console.error('ESP32 notification failed:', receiverError.message);
        }

        res.status(200).json({ 
            message: 'Data processed', 
            distance, 
            state: currentState, 
            trafficLight: trafficLightKey 
        });
    } catch (error) {
        console.error('Error processing GPS:', error.message);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

app.get('/get-state', (req, res) => {
    const { latitude, longitude } = req.query;
    if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    const trafficLightKey = `${latitude},${longitude}`;
    const state = trafficLightStates.get(trafficLightKey) || 0;
    console.log(`State requested (${trafficLightKey}): ${state}`);
    res.json({ state });
});

app.get('/ambulance-location', (req, res) => {
    console.log('Ambulance location requested:', ambulanceLocation);
    res.json(ambulanceLocation);
});

app.post('/update-ambulance', async (req, res) => {
    const { latitude, longitude, route } = req.body;
    if (!latitude || !longitude || !route) {
        console.log('Invalid ambulance update:', req.body);
        return res.status(400).json({ error: 'Invalid data' });
    }

    ambulanceLocation = { latitude, longitude };
    console.log('Ambulance location updated:', ambulanceLocation);

    let minDistance = Infinity;
    let nearestSignal = null;
    let ambulanceIndex = route.findIndex(pt => 
        Math.abs(pt[0] - latitude) < 0.0001 && 
        Math.abs(pt[1] - longitude) < 0.0001
    );

    // Check and update signals being passed (> 10m behind)
    trafficSignals = await Promise.all(trafficSignals.map(async (signal) => {
        const signalPos = { latitude: signal.latitude, longitude: signal.longitude };
        const routeIndex = route.findIndex(pt => 
            Math.abs(pt[0] - signal.latitude) < 0.0001 && 
            Math.abs(pt[1] - signal.longitude) < 0.0001
        );
        const distance = haversine(ambulanceLocation, signalPos, { unit: 'meter' });
        const trafficLightKey = `${signal.latitude},${signal.longitude}`;

        if (routeIndex < ambulanceIndex && distance > 10) {
            console.log(`Signal passed at ${signal.latitude},${signal.longitude} (distance: ${distance}m)`);
            if (trafficLightStates.get(trafficLightKey) !== 0) {  // If not already red
                try {
                    const gasPrice = await web3.eth.getGasPrice();
                    const receipt = await contract.methods.updateTrafficLight(Math.floor(distance))
                        .send({ from: senderAccount, gas: 1000000, gasPrice });
                    console.log(`Contract updated for ${trafficLightKey}: ${receipt.transactionHash}`);

                    trafficLightStates.set(trafficLightKey, 0);  // Set to red
                    console.log(`State reverted to red (${trafficLightKey}): 0`);

                    await axios.post(receiverEsp32Url, { 
                        state: 0,
                        latitude: signal.latitude,
                        longitude: signal.longitude
                    });
                    console.log(`ESP32 notified to turn red: ${trafficLightKey}`);
                } catch (error) {
                    console.error(`Failed to revert signal ${trafficLightKey} to red: ${error.message}`);
                }
            }
            return null;  // Mark for removal
        }
        return signal;  // Keep signal
    }));

    // Filter out null values (passed signals)
    trafficSignals = trafficSignals.filter(signal => signal !== null);

    // Find nearest upcoming signal and update state if < 100m
    for (const signal of trafficSignals) {
        const signalPos = { latitude: signal.latitude, longitude: signal.longitude };
        const routeIndex = route.findIndex(pt => 
            Math.abs(pt[0] - signal.latitude) < 0.0001 && 
            Math.abs(pt[1] - signal.longitude) < 0.0001
        );

        if (routeIndex > ambulanceIndex && routeIndex !== -1) {
            const distance = haversine(ambulanceLocation, signalPos, { unit: 'meter' });
            if (distance < minDistance) {
                minDistance = distance;
                nearestSignal = signalPos;

                const trafficLightKey = `${signal.latitude},${signal.longitude}`;
                let newState = trafficLightStates.get(trafficLightKey) || 0;

                if (distance < 100 && newState !== 2) {
                    try {
                        const gasPrice = await web3.eth.getGasPrice();
                        const receipt = await contract.methods.updateTrafficLight(Math.floor(distance))
                            .send({ from: senderAccount, gas: 1000000, gasPrice });
                        console.log(`Contract updated for ${trafficLightKey}: ${receipt.transactionHash}`);

                        newState = 2;  // Green
                        trafficLightStates.set(trafficLightKey, newState);
                        console.log(`State updated (${trafficLightKey}): ${newState}`);

                        await axios.post(receiverEsp32Url, { 
                            state: newState,
                            latitude: signal.latitude,
                            longitude: signal.longitude
                        });
                        console.log(`ESP32 notified to turn green: ${trafficLightKey}`);
                    } catch (error) {
                        console.error(`Failed to update signal ${trafficLightKey}: ${error.message}`);
                    }
                }
            }
        }
    }

    res.json({
        ambulance: ambulanceLocation,
        nearestSignal: nearestSignal,
        distanceToNearest: nearestSignal ? Math.floor(minDistance) : null
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on port 3000');
});