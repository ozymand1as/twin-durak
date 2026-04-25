// WebRTC Signaling Logic
let peerConnection;
let dataChannel;

const config = {
    iceServers: [] // Fully local, no STUN/TURN
};

// UI Elements
const els = {
    screens: {
        main: document.getElementById('main-menu'),
        host: document.getElementById('host-screen'),
        join: document.getElementById('join-screen'),
        game: document.getElementById('game-screen')
    },
    buttons: {
        host: document.getElementById('btn-host'),
        join: document.getElementById('btn-join'),
        hostScanClient: document.getElementById('btn-host-scan-client'),
        hostCancelScan: document.getElementById('btn-host-cancel-scan')
    },
    qr: {
        hostCanvas: document.getElementById('host-qr'),
        joinCanvas: document.getElementById('join-qr')
    },
    steps: {
        host1: document.getElementById('host-step-1'),
        host2: document.getElementById('host-step-2'),
        join1: document.getElementById('join-step-1'),
        join2: document.getElementById('join-step-2')
    },
    scanners: {
        hostContainer: document.getElementById('host-scanner-container'),
        joinContainer: document.getElementById('join-scanner-container')
    }
};

let activeScanner = null;

function showScreen(screenName) {
    Object.values(els.screens).forEach(s => s.classList.remove('active'));
    els.screens[screenName].classList.add('active');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function setupDataChannel(channel, isHostConnection) {
    channel.onopen = () => {
        showToast("Connected!");
        showScreen('game');
        startGameLogic(isHostConnection);
    };
    channel.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleNetworkMessage(msg);
        } catch(e) {
            console.error("Msg parse error", e);
        }
    };
    channel.onclose = () => showToast("Disconnected.");
    channel.onerror = (e) => console.error("Channel error", e);
}

// ... update startHosting and startJoining calls to setupDataChannel


async function startScanner(containerId, onScanSuccess) {
    document.getElementById(containerId).parentElement.classList.remove('hidden');
    activeScanner = new Html5Qrcode(containerId);
    try {
        await activeScanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                stopScanner();
                document.getElementById(containerId).parentElement.classList.add('hidden');
                onScanSuccess(decodedText);
            },
            (err) => { /* scanning */ }
        );
    } catch (err) {
        console.error(err);
        showToast("Camera error: " + err);
    }
}

function stopScanner() {
    if (activeScanner) {
        activeScanner.stop().catch(e => console.error(e));
        activeScanner = null;
    }
}

// ------ HOST LOGIC ------ //
async function startHosting() {
    showScreen('host');
    els.steps.host1.classList.add('active');
    document.getElementById('host-loading-txt').classList.remove('hidden');
    document.getElementById('host-qr-container').classList.add('hidden');
    
    peerConnection = new RTCPeerConnection(config);
    dataChannel = peerConnection.createDataChannel('durak');
    setupDataChannel(dataChannel, true);

    peerConnection.onicecandidate = (event) => {
        // We do not strictly need to wait for null, we just need the local host candidate.
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Wait 1 second for local ICE candidates to gather, then generate QR
    setTimeout(() => {
        const offerStr = JSON.stringify(peerConnection.localDescription);
        try {
            els.qr.hostCanvas.innerHTML = "";
            new QRCode(els.qr.hostCanvas, {
                text: offerStr,
                width: 450,
                height: 450,
                correctLevel: QRCode.CorrectLevel.L
            });
            document.getElementById('host-loading-txt').classList.add('hidden');
            document.getElementById('host-qr-container').classList.remove('hidden');
        } catch (error) {
            console.error("QR formatting error:", error);
            showToast("Failed to generate QR Code");
        }
    }, 1000);
}

els.buttons.hostScanClient.addEventListener('click', () => {
    document.getElementById('host-qr-container').classList.add('hidden');
    startScanner('host-scanner', async (decodedText) => {
        try {
            const answer = JSON.parse(decodedText);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            showToast("Connecting...");
        } catch(e) {
            showToast("Invalid QR code");
        }
    });
});

    els.buttons.hostCancelScan.addEventListener('click', () => {
        stopScanner();
        els.scanners.hostContainer.classList.add('hidden');
        document.getElementById('host-qr-container').classList.remove('hidden');
    });

    // ------ JOIN LOGIC ------ //
    async function startJoining() {
        showScreen('join');
        els.steps.join1.classList.add('active');
        els.steps.join2.classList.remove('active');
        document.getElementById('join-loading-txt').classList.remove('hidden');
        document.getElementById('join-qr-container').classList.add('hidden');

    peerConnection = new RTCPeerConnection(config);
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel, false);
    };

    startScanner('join-scanner', async (decodedText) => {
        try {
            const offer = JSON.parse(decodedText);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            peerConnection.onicecandidate = (evt) => {
                // Ignore, handled by timeout
            };
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            setTimeout(() => {
                const answerStr = JSON.stringify(peerConnection.localDescription);
                try {
                    els.qr.joinCanvas.innerHTML = "";
                    new QRCode(els.qr.joinCanvas, {
                        text: answerStr,
                        width: 450,
                        height: 450,
                        correctLevel: QRCode.CorrectLevel.L
                    });
                    document.getElementById('join-loading-txt').classList.add('hidden');
                    document.getElementById('join-qr-container').classList.remove('hidden');
                } catch (err) {
                    console.error("Join QR Error:", err);
                    showToast("Failed to generate Answer QR");
                }
            }, 1000);
        } catch(e) {
            console.error(e);
            showToast("Failed to parse Host's QR code");
        }
    });
}

// ------ BINDINGS ------ //
els.buttons.host.addEventListener('click', startHosting);
els.buttons.join.addEventListener('click', startJoining);

// ====== GAME LOGIC ====== //
let GAME = {
    isHost: false,
    deck: [],
    trump: null,
    hands: { me: [], opponent: 0 },
    table: [], // array of { attack: card, defense: card or null }
    attacker: null, // "host" or "client"
    turn: null, // who is currently supposed to play a card
    discardSize: 0
};

const SUITS = ['♠', '♣', '♥', '♦'];
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
    let deck = [];
    for (const suit of SUITS) {
        for (let i = 0; i < RANKS.length; i++) {
            deck.push({ id: `${suit}${RANKS[i]}`, suit, rank: RANKS[i], val: i });
        }
    }
    // shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function sendMsg(type, payload) {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({type, payload}));
    }
}

function syncState() {
    if (!GAME.isHost) return;
    // Host sends specific view to client
    let clientState = {
        trump: GAME.trump,
        deckSize: GAME.deck.length,
        // Hand for client is not stored directly in host state to avoid confusing,
        // Wait, host must store BOTH hands to validate everything!
        // Let's modify host state to hold both hands if isHost.
    };
    sendMsg('STATE_SYNC', clientState);
    renderGame();
}

function startGameLogic(isHost) {
    GAME.isHost = isHost;
    if (isHost) {
        let deck = createDeck();
        GAME.trump = deck[0]; // bottom card
        
        let clientHand = deck.splice(-6);
        let hostHand = deck.splice(-6);
        
        // Host state keeps full knowledge
        GAME.deck = deck;
        GAME.hands = { host: hostHand, client: clientHand };
        
        GAME.attacker = 'host';
        GAME.turn = 'host';
        
        syncFullState();
    }
}

function syncFullState() {
    if (!GAME.isHost) return;
    
    // Send client their state
    let clientState = {
        trump: GAME.trump,
        deckSize: GAME.deck.length,
        hand: GAME.hands.client,
        opponentCards: GAME.hands.host.length,
        table: GAME.table,
        attacker: GAME.attacker,
        turn: GAME.turn,
        discardSize: GAME.discardSize
    };
    sendMsg('STATE_SYNC', clientState);
    renderGame(); // render host
}

function handleNetworkMessage(msg) {
    if (msg.type === 'STATE_SYNC' && !GAME.isHost) {
        GAME.trump = msg.payload.trump;
        GAME.deckSize = msg.payload.deckSize; 
        GAME.hands.me = msg.payload.hand;
        GAME.hands.opponent = msg.payload.opponentCards;
        GAME.table = msg.payload.table;
        GAME.attacker = msg.payload.attacker;
        GAME.turn = msg.payload.turn;
        GAME.discardSize = msg.payload.discardSize;
        renderGame();
    } else if (msg.type === 'ACTION' && GAME.isHost) {
        handleClientAction(msg.payload);
    }
}

function handleClientAction(action) {
    // To be implemented: host validates action and updates state, then calls syncFullState()
}

// ------ UI RENDERING ------ //
function getCardHTML(card) {
    if (!card) return '';
    let color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
    return `<div class="card" style="color:${color}" data-id="${card.id}">
        <span class="rank" style="position:absolute; top:5px; left:5px; font-size:1rem;">${card.rank}</span>
        <span class="suit">${card.suit}</span>
        <span class="rank" style="position:absolute; bottom:5px; right:5px; font-size:1rem; transform: rotate(180deg);">${card.rank}</span>
    </div>`;
}

function renderGame() {
    // Common references
    const meHtml = GAME.isHost ? GAME.hands.host : GAME.hands.me;
    const oppCount = GAME.isHost ? GAME.hands.client.length : GAME.hands.opponent;
    const isMyTurn = (GAME.isHost && GAME.turn === 'host') || (!GAME.isHost && GAME.turn === 'client');
    const myRole = (GAME.isHost && GAME.attacker === 'host') || (!GAME.isHost && GAME.attacker === 'client') ? 'Attacker' : 'Defender';
    
    // Status text
    const statusTxt = isMyTurn ? `Your Turn (${myRole})` : `Waiting for opponent...`;
    document.getElementById('player-status').textContent = statusTxt;
    document.getElementById('opponent-status').textContent = isMyTurn ? `Waiting for you...` : `Opponent's Turn`;

    // Render my hand
    const handBox = document.getElementById('player-hand');
    handBox.innerHTML = '';
    meHtml.forEach((c) => {
        let cd = document.createElement('div');
        cd.innerHTML = getCardHTML(c);
        let el = cd.firstElementChild;
        if (isMyTurn) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => attemptPlayCard(c));
        }
        handBox.appendChild(el);
    });

    // Render opponent hand
    const oppBox = document.getElementById('opponent-hand');
    oppBox.innerHTML = '';
    for(let i=0; i<oppCount; i++) {
        oppBox.innerHTML += `<div class="card back"></div>`;
    }

    // Render table, deck, trump
    const deckSizeStr = GAME.isHost ? GAME.deck.length : GAME.deckSize;
    document.getElementById('cards-left').textContent = deckSizeStr;
    const trumpBox = document.getElementById('trump-card');
    trumpBox.innerHTML = GAME.trump && deckSizeStr > 0 ? getCardHTML(GAME.trump) : '';
    
    document.getElementById('deck-pile').style.display = deckSizeStr > 0 ? 'block' : 'none';

    // Buttons
    document.getElementById('btn-take').classList.toggle('hidden', myRole === 'Attacker' || !isMyTurn);
    document.getElementById('btn-pass').classList.toggle('hidden', myRole === 'Defender' || !isMyTurn);
}

function attemptPlayCard(card) {
    if (GAME.isHost) {
        // ... process local action
    } else {
        sendMsg('ACTION', { type: 'PLAY', cardId: card.id });
    }
}


