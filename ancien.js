const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mediasoup = require('mediasoup');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Allow requests from any origin
app.use(cors({
  origin: '*',
}));

const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  },
});

// Global variables for rooms and peers
let worker;
let rooms = {};  // Store rooms with their transports and routers
let peers = {};  // Store participant information by room

// Create a Mediasoup worker
const createWorker = async () => {
  worker = await mediasoup.createWorker();
  console.log('Mediasoup worker created');
  return worker;
};

// Function to get public IP
const getPublicIP = async () => {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;  // Return public IP address
  } catch (error) {
    console.error('Error retrieving public IP:', error);
    return null;
  }
};

// Function to create a WebRTC transport
const createWebRtcTransport = async (router) => {
  const publicIp = await getPublicIP();  // Get public IP
  console.log(`Using public IP: ${publicIp}`);
  
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: publicIp }], // Replace with public IP
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  return transport;
};

createWorker().then(async () => {
  io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // Envoi de la liste des rooms existantes au client
    socket.on('getRooms', (callback) => {
      const roomList = Object.keys(rooms);
      
      // Renvoie la liste des rooms au client
      callback({ rooms: roomList });
    });
    
    // Create a room
    socket.on('createRoom', async (roomId, callback) => {
      if (rooms[roomId]) {
        return callback({ error: 'Room already exists' });
      }
      
      const router = await worker.createRouter({
        mediaCodecs: [
          { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
          { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
        ],
      });

      rooms[roomId] = {
        router: router,
        peers: {},
      };

      console.log(`Room ${roomId} created`);
      callback({ roomId: roomId, routerRtpCapabilities: router.rtpCapabilities });
    });

    socket.on('connectTransport', async (req)=> {
      console.log('eto');
      
    })

    // Join an existing room
    socket.on('joinRoom', async ({ roomId, peerId }, callback) => {
      const room = rooms[roomId];

      if (!room) {
        return callback({ error: 'Room does not exist' });
      }

      try {
        // Create a transport for the user joining
        const transport = await createWebRtcTransport(room.router);
        room.peers[peerId] = { transport, socketId: socket.id };

        // Store peer information
        peers[socket.id] = { roomId, peerId };

        console.log(`Peer ${peerId} joined room ${roomId}`);

        // Return transport details
        callback({
          transportOptions: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });
      } catch (error) {
        console.error('Error joining room:', error);
        callback({ error: 'Could not create WebRTC transport' });
      }
    });

    // Handle producer stream publication
    
    socket.on('produce', async ({ roomId, kind, rtpParameters }, callback) => {
      const room = rooms[roomId];
      if (!room) return callback({ error: 'Room not found' });
    
      const peer = room.peers[socket.id];
      if (!peer) return callback({ error: 'Peer not found' });
    
      try {
        const producer = await peer.transport.produce({ kind, rtpParameters });
        peer.producer = producer;
    
        console.log(`Produced stream: ${kind}`);
        callback({ id: producer.id });
      } catch (error) {
        console.error('Error producing:', error);
        callback({ error: 'Error producing stream' });
      }
    });    

    // Handle stream consumption by the consumer
    socket.on('consume', async ({ roomId, peerId, producerId, rtpCapabilities }, callback) => {
      const room = rooms[roomId];
      const peer = room.peers[peerId];
      if (!peer) return callback({ error: 'Peer not found' });

      // Check if the consumer can consume the stream
      if (!room.router.canConsume({
        producerId,
        rtpCapabilities
      })) {
        return callback({ error: 'Cannot consume' });
      }

      try {
        // Create a consumer for this peer
        const consumer = await peer.transport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // Consumer starts paused to avoid packet loss
        });

        console.log(`Peer ${peerId} consuming from producer ${producerId}`);

        // Notify peer about the consumer details
        callback({
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });

        // Resume the consumer after it is successfully created
        await consumer.resume();

        // Notify the producer that the consumer is ready
        socket.to(roomId).emit('consumerReady', { consumerId: consumer.id, producerId });

      } catch (error) {
        console.error('Error consuming:', error);
        callback({ error: 'Could not consume stream' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      const peerData = peers[socket.id];
      if (peerData) {
        const { roomId, peerId } = peerData;
        const room = rooms[roomId];
        if (room) {
          delete room.peers[peerId];
          console.log(`Peer ${peerId} left room ${roomId}`);

          if (Object.keys(room.peers).length === 0) {
            delete rooms[roomId]; // Delete the room if it is empty
            console.log(`Room ${roomId} deleted`);
          }
        }
      }
    });
  });
});

// Start the server
const PORT = 4400;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server is running on port ${PORT}`);
});
