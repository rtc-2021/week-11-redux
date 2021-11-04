const cookieParser = require('cookie-parser');
const express = require('express');
const io = require('socket.io')();
const logger = require('morgan');
const path = require('path');

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

const namespaces = io.of(/^\/[a-z]{3}\-[a-z]{4}\-[a-z]{3}$/)

namespaces.on('connection', function(socket) {
  const namespace = socket.nsp;

  socket.broadcast.emit('connected peer');

  // listen for signals
  socket.on('signal', function(signal) {
    socket.broadcast.emit('signal', signal);
  })
  // listen for disconnects
  socket.on('disconnect', function() {
    namespace.emit('disconnected peer');
  })

});

/*

Stolley Cheat-sheet

const mp_namespaces = io.of(/^\/[a-z]{3}\-[a-z]{4}\-[a-z]{3}$/);

mp_namespaces.on('connect', function(socket) {

  const namespace = socket.nsp;

  const peers = [];

  for (let peer of namespace.sockets.keys()) {
    peers.push(peer);
  }

  console.log(`    Socket namespace: ${namespace.name}`);

  // Send the array of connected-peer IDs to the connecting peer
  socket.emit('connected peers', peers);

  // Send the connecting peer ID to all connected peers
  socket.broadcast.emit('connected peer', socket.id);

  socket.on('signal', function({ to, from, signal }) {
    socket.to(to).emit('signal', { to, from, signal });
  });

  socket.on('disconnect', function() {
    namespace.emit('disconnected peer', socket.id);
  });

});

*/

module.exports = { app, io };
