'use strict';

/**
 *  Global Variables: $self and $peer
 */

const $self = {
  rtcConfig: null,
  isPolite: false,
  isMakingOffer: false,
  isIgnoringOffer: false,
  isSettingRemoteAnswerPending: false,
  mediaConstraints: { audio: false, video: true }
};

const $peer = {
  connection: new RTCPeerConnection($self.rtcConfig)
};



/**
 *  Signaling-Channel Setup
 */

const namespace = prepareNamespace(window.location.hash, true);

const sc = io.connect('/' + namespace, { autoConnect: false });

registerScCallbacks();



/**
 * =========================================================================
 *  Begin Application-Specific Code
 * =========================================================================
 */



/**
 *  User-Interface Setup
 */

document.querySelector('#header h1')
  .innerText = 'Welcome to Room #' + namespace;

document.querySelector('#call-button')
  .addEventListener('click', handleCallButton);



/**
 *  User Features and Media Setup
 */

requestUserMedia($self.mediaConstraints);



/**
 *  User-Interface Functions and Callbacks
 */

function handleCallButton(event) {
  const callButton = event.target;
  if (callButton.className === 'join') {
    console.log('Joining the call...');
    callButton.className = 'leave';
    callButton.innerText = 'Leave Call';
    joinCall();
  } else {
    console.log('Leaving the call...');
    callButton.className = 'join';
    callButton.innerText = 'Join Call';
    leaveCall();
  }
}

function joinCall() {
  sc.open();
}

function leaveCall() {
  self.isPolite = false;
  sc.close();
  resetCall($peer);
}



/**
 *  User-Media and Data-Channel Functions
 */

async function requestUserMedia(media_constraints) {
  $self.stream = new MediaStream();
  $self.media = await navigator.mediaDevices
    .getUserMedia(media_constraints);
  $self.stream.addTrack($self.media.getTracks()[0]);
  displayStream('#self', $self.stream);
}

function displayStream(selector, stream) {
  document.querySelector(selector).srcObject = stream;
}

function addStreamingMedia(peer, stream) {
  if (stream) {
    for (let track of stream.getTracks()) {
      peer.connection.addTrack(track, stream);
    }
  }
}



/**
 *  Call Features & Reset Functions
 */

function establishCallFeatures(peer) {
  registerRtcCallbacks(peer);
  addStreamingMedia(peer, $self.stream);
}

function resetCall(peer) {
  displayStream('#peer', null);
  peer.connection.close();
  resetObjectKeys(peer);
  peer.connection = new RTCPeerConnection($self.rtcConfig);
}



/**
 *  WebRTC Functions and Callbacks
 */

function registerRtcCallbacks(peer) {
  peer.connection
    .onconnectionstatechange = handleRtcConnectionStateChange;
  peer.connection
    .onnegotiationneeded = handleRtcConnectionNegotiation;
  peer.connection
    .onicecandidate = handleRtcIceCandidate;
  peer.connection
    .ontrack = handleRtcPeerTrack;
}

function handleRtcPeerTrack({ track, streams: [stream] }) {
  console.log('Attempt to display media from peer...');
  displayStream('#peer', stream);
}



/**
 * =========================================================================
 *  End Application-Specific Code
 * =========================================================================
 */



/**
 *  Reusable WebRTC Functions and Callbacks
 */

async function handleRtcConnectionNegotiation() {
  if ($self.isSuppressingInitialOffer) return;
  try {
    $self.isMakingOffer = true;
    await $peer.connection.setLocalDescription();
  } catch(e) {
    const offer = await $peer.connection.createOffer();
    await $peer.connection.setLocalDescription(offer);
  } finally {
    sc.emit('signal',
      { description: $peer.connection.localDescription });
    $self.isMakingOffer = false;
  }
}

function handleRtcIceCandidate({ candidate }) {
  sc.emit('signal', { candidate: candidate });
}

function handleRtcConnectionStateChange() {
  const connectionState = $peer.connection.connectionState;
  document.querySelector('body').className = connectionState;
}



/**
 *  Signaling-Channel Functions and Callbacks
 */

function registerScCallbacks() {
  sc.on('connect', handleScConnect);
  sc.on('connected peer', handleScConnectedPeer);
  sc.on('disconnected peer', handleScDisconnectedPeer);
  sc.on('signal', handleScSignal);
}

function handleScConnect() {
  console.log('Successfully connected to the signaling server!');
  establishCallFeatures($peer);
}

function handleScConnectedPeer() {
  $self.isPolite = true;
}

function handleScDisconnectedPeer() {
  resetCall($peer);
  establishCallFeatures($peer);
}

function resetAndRetryConnection(peer) {
  $self.isMakingOffer = false;
  $self.isIgnoringOffer = false;
  $self.isSettingRemoteAnswerPending = false;
  $self.isSuppressingInitialOffer = $self.isPolite;

  resetCall(peer);
  establishCallFeatures(peer);

  if ($self.isPolite) {
    sc.emit('signal', { description: { type: '_reset' } });
  }
}

async function handleScSignal({ description, candidate }) {
  if (description) {

    if (description.type === '_reset') {
      resetAndRetryConnection($peer);
      return;
    }

    const readyForOffer =
          !$self.isMakingOffer &&
          ($peer.connection.signalingState === 'stable'
            || $self.isSettingRemoteAnswerPending);

    const offerCollision = description.type === 'offer' && !readyForOffer;

    $self.isIgnoringOffer = !$self.isPolite && offerCollision;

    if ($self.isIgnoringOffer) {
      return;
    }

    $self.isSettingRemoteAnswerPending = description.type === 'answer';
    try {
      console.log('Signaling state on incoming description:',
        $peer.connection.signalingState);
      await $peer.connection.setRemoteDescription(description);
    } catch(e) {
      resetAndRetryConnection($peer);
      return;
    }
    $self.isSettingRemoteAnswerPending = false;

    if (description.type === 'offer') {
      try {
        await $peer.connection.setLocalDescription();
      } catch(e) {
        const answer = await $peer.connection.createAnswer();
        await $peer.connection.setLocalDescription(answer);
      } finally {
        sc.emit('signal',
          { description: $peer.connection.localDescription });
        $self.isSuppressingInitialOffer = false;
      }
    }
  } else if (candidate) {
    // Handle ICE candidates
    try {
      await $peer.connection.addIceCandidate(candidate);
    } catch(e) {
      // Log error unless $self is ignoring offers
      // and candidate is not an empty string
      if (!$self.isIgnoringOffer && candidate.candidate.length > 1) {
        console.error('Unable to add ICE candidate for peer:', e);
      }
    }
  }
}



/**
 *  Utility Functions
 */

function prepareNamespace(hash, set_location) {
  let ns = hash.replace(/^#/, ''); // remove # from the hash
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(ns)) {
    console.log(`Checked existing namespace '${ns}'`);
    return ns;
  }

  ns = generateRandomAlphaString('-', 3, 4, 3);

  console.log(`Created new namespace '${ns}'`);
  if (set_location) window.location.hash = ns;
  return ns;
}

function generateRandomAlphaString(separator, ...groups) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let ns = [];
  for (let group of groups) {
    let str = '';
    for (let i = 0; i < group; i++) {
      str += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    ns.push(str);
  }
  return ns.join(separator);
}

function resetObjectKeys(obj) {
  for (let key of Object.keys(obj)) {
    delete obj[key];
  }
}
