const express = require('express');
import http from 'http';
import mediasoup from 'mediasoup';
import cors from 'cors';
// import * as socket from 'socket.io'
import { Server, Socket } from 'socket.io';

const app = express();
app.use(cors({
  origin: '*',
}));

type ParticipantType = {
  participantId: string[]
  stream: any[]
}

type RoomType = {
  router: Promise<mediasoup.types.Router<mediasoup.types.AppData>>,
  participants: ParticipantType
}

type Joining = {
  roomId: string,
  participantId: string
}

type ProduceType = {
  roomId: string,
  stream: any
}

type ConsumeType = {
  roomId: string,
  participantId: string
}

const rooms: {[roomId: string]: RoomType} = {}

const server = http.createServer(app);
const io = new Server(server, {cors: {
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}});
// const io = socketIO(server, {
//   cors: {
//     origin: '*',
//     methods: ['GET', 'POST'],
//     allowedHeaders: ['Content-Type', 'Authorization'],
//     credentials: true,
//   },
// });

let worker:Promise<mediasoup.types.Worker<mediasoup.types.AppData>>;

const createWorker = async () => {
  // worker = await mediasoup.createWorker();
  worker.then(async ()=> {
    await mediasoup.createWorker();
    console.log('Mediasoup worker created');
  }).catch((Error) => {
    console.log(Error);
  })
  return worker
}

createWorker().then(async ()=> {
  io.on('connection', (Socket) => {
    console.log(`New client connected: ${Socket.id}`);
    
    Socket.on('createRoom', async (roomId: string, requestIdleCallback) => {
      // const checkRoom = room.filter((item) => item == roomId)
      if (rooms[roomId]) {
        return requestIdleCallback({error: 'Room already exist'})
      }

      const router = (await worker).createRouter({
        mediaCodecs: [
          { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
          { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
        ],
      });

      rooms[roomId] = {
        router: router,
        participants: {
          participantId:[],
          stream:[]
        },
      };

      console.log(`Room ${roomId} created`);
      
    });

    Socket.on('joinRoom', async({roomId, participantId}: Joining) => {
      const room = rooms[roomId];

      if (!room) {
        return console.log({ error: 'Room does not exist' });
      }

      try {
        room.participants.participantId.push(participantId);
        console.log(`Partcipant: ${participantId}, joined room: ${roomId}`);
      } catch (error) {
        console.log('Error joining room', error);
      }
    })

    Socket.on('produce', async ({roomId, stream}: ProduceType) => {
      const room = rooms[roomId];
      if (!room) {
        return console.log({ error: 'Room does not exist' });
      }

      try {
        room.participants.stream.push(stream)
        console.log('Stream uploaded');
      } catch (error) {
        console.log( error);
      }      
    });

    Socket.on('consume', async ({roomId, participantId}:ConsumeType)=> {
      const room = rooms[roomId];
      if (!room) {
        return console.log({ error: 'Room does not exist' });
      }
      const participant = room.participants.participantId.filter((item)=> {return item == participantId})
      if (participant.length == 0) {
        return console.log({error: 'participant doesnt exist'});
      }
      Socket.emit('getStream', room.participants.stream)
    })

    // Socket.on('disconnect', ()=> {
    //   const participant = rooms[]
    // })

  });
});

const PORT = 4400;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server is running on port ${PORT}`);
});
