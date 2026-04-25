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


let currentQrInterval = null;

function renderAnimatedQR(containerElement, progressDivElement, payload) {
    if (currentQrInterval) clearInterval(currentQrInterval); 
    
    // Safety chunking mechanism
    const chunkSize = 150; 
    const chunks = [];
    for (let i = 0; i < payload.length; i += chunkSize) {
        chunks.push(payload.slice(i, i + chunkSize));
    }
    
    const formattedChunks = chunks.map((c, i) => `${i+1}/${chunks.length}:${c}`);
    let currentIndex = 0;
    
    const drawChunk = () => {
        containerElement.innerHTML = "";
        new QRCode(containerElement, {
            text: formattedChunks[currentIndex],
            width: 350,
            height: 350,
            correctLevel: QRCode.CorrectLevel.M
        });
        progressDivElement.textContent = `Showing part ${currentIndex + 1} of ${formattedChunks.length}`;
        currentIndex = (currentIndex + 1) % formattedChunks.length;
    };
    
    drawChunk();
    if (formattedChunks.length > 1) {
        currentQrInterval = setInterval(drawChunk, 800);
    }
}

async function startScanner(containerId, progressId, onScanSuccess) {
    document.getElementById(containerId).parentElement.classList.remove('hidden');
    let progressDiv = document.getElementById(progressId);
    progressDiv.textContent = "Scanning... point camera at QR code.";
    progressDiv.classList.remove('hidden');
    
    activeScanner = new Html5Qrcode(containerId);
    
    let totalExpected = 0;
    let collectedChunks = {};
    
    try {
        await activeScanner.start(
            { facingMode: "environment" },
            { fps: 15 },
            (decodedText) => {
                const match = decodedText.match(/^(\d+)\/(\d+):(.*)$/);
                if (match) {
                    const idx = parseInt(match[1]);
                    totalExpected = parseInt(match[2]);
                    const data = match[3];
                    
                    if (!collectedChunks[idx]) {
                        collectedChunks[idx] = data;
                        const count = Object.keys(collectedChunks).length;
                        progressDiv.textContent = `Captured ${count} of ${totalExpected} parts... Keep scanning!`;
                        
                        if (count === totalExpected) {
                            stopScanner();
                            document.getElementById(containerId).parentElement.classList.add('hidden');
                            
                            let fullString = "";
                            for(let i=1; i<=totalExpected; i++) fullString += collectedChunks[i];
                            onComplete(fullString);
                        }
                    }
                } else if (Object.keys(collectedChunks).length === 0) {
                    // Try to catch unchunked backwards compatibility just in case
                    stopScanner();
                    document.getElementById(containerId).parentElement.classList.add('hidden');
                    onComplete(decodedText);
                }
            },
            (err) => { /* ignore */ }
        );
        
        // Hoist the success callback
        function onComplete(res) {
            onScanSuccess(res);
        }
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
        const compressedOffer = LZString.compressToBase64(offerStr);
        
        try {
            renderAnimatedQR(
                els.qr.hostCanvas, 
                document.getElementById('host-qr-progress'), 
                compressedOffer, 
                "host"
            );
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
    if (currentQrInterval) clearInterval(currentQrInterval);
    
    startScanner('host-scanner', 'host-scan-progress', async (decodedText) => {
        try {
            const decompressed = LZString.decompressFromBase64(decodedText);
            const answer = JSON.parse(decompressed);
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

    startScanner('join-scanner', 'join-scan-progress', async (decodedText) => {
        try {
            const decompressed = LZString.decompressFromBase64(decodedText);
            const offer = JSON.parse(decompressed);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            peerConnection.onicecandidate = (evt) => {
                // Ignore, handled by timeout
            };
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            setTimeout(() => {
                const answerStr = JSON.stringify(peerConnection.localDescription);
                const compressedAnswer = LZString.compressToBase64(answerStr);
                
                try {
                    renderAnimatedQR(
                        els.qr.joinCanvas, 
                        document.getElementById('join-qr-progress'), 
                        compressedAnswer, 
                        "join"
                    );
                    document.getElementById('join-loading-txt').classList.add('hidden');
                    document.getElementById('join-qr-container').classList.remove('hidden');
                    els.steps.join1.classList.remove('active');
                    els.steps.join2.classList.add('active');
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
        handleAction(msg.payload, 'client');
    }
}

function handleAction(action, player) {
    if (action.type === 'PLAY') {
        const hand = player === 'host' ? GAME.hands.host : GAME.hands.client;
        const cardIndex = hand.findIndex(c => c.id === action.cardId);
        if (cardIndex === -1) return;
        const card = hand[cardIndex];

        const isAttacker = GAME.attacker === player;
        
        if (isAttacker) {
            let canAttack = false;
            if (GAME.table.length === 0) {
                canAttack = true; 
            } else {
                const allRanks = [];
                GAME.table.forEach(pair => {
                    allRanks.push(pair.attack.rank);
                    if (pair.defense) allRanks.push(pair.defense.rank);
                });
                if (allRanks.includes(card.rank)) canAttack = true;
            }
            
            if (canAttack) {
                hand.splice(cardIndex, 1);
                GAME.table.push({ attack: card, defense: null });
                GAME.turn = player === 'host' ? 'client' : 'host'; 
                syncFullState();
            }
        } else {
            const unbeatenIndex = GAME.table.findIndex(pair => pair.defense === null);
            if (unbeatenIndex !== -1) {
                const attackCard = GAME.table[unbeatenIndex].attack;
                let canBeat = false;
                const isTrump = card.suit === GAME.trump.suit;
                const isAttackTrump = attackCard.suit === GAME.trump.suit;
                
                if (isTrump && !isAttackTrump) {
                    canBeat = true;
                } else if (card.suit === attackCard.suit && card.val > attackCard.val) {
                    canBeat = true;
                }
                
                if (canBeat) {
                    hand.splice(cardIndex, 1);
                    GAME.table[unbeatenIndex].defense = card;
                    GAME.turn = player === 'host' ? 'client' : 'host'; 
                    syncFullState();
                }
            }
        }
    } else if (action.type === 'TAKE') {
        if (GAME.attacker !== player && GAME.table.length > 0) { 
            const hand = player === 'host' ? GAME.hands.host : GAME.hands.client;
            GAME.table.forEach(pair => {
                hand.push(pair.attack);
                if (pair.defense) hand.push(pair.defense);
            });
            GAME.table = [];
            replenishHands(GAME.attacker);
            GAME.turn = GAME.attacker;
            syncFullState();
        }
    } else if (action.type === 'PASS') {
        if (GAME.attacker === player) { 
            const allDefended = GAME.table.every(pair => pair.defense !== null);
            if (allDefended && GAME.table.length > 0) {
                GAME.discardSize += GAME.table.length * 2;
                GAME.table = [];
                replenishHands(GAME.attacker);
                GAME.attacker = player === 'host' ? 'client' : 'host';
                GAME.turn = GAME.attacker;
                syncFullState();
            }
        }
    }
}

function replenishHands(firstPlayer) {
    const p1 = firstPlayer;
    const p2 = firstPlayer === 'host' ? 'client' : 'host';
    const handsToFill = [p1, p2];
    for (let p of handsToFill) {
        const hand = p === 'host' ? GAME.hands.host : GAME.hands.client;
        while (hand.length < 6 && GAME.deck.length > 0) {
            hand.push(GAME.deck.pop());
        }
    }
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

    // Render table cards
    const playArea = document.getElementById('play-area');
    if (playArea) {
        playArea.innerHTML = '';
        GAME.table.forEach(pair => {
            let container = document.createElement('div');
            container.style.position = 'relative';
            container.style.width = '60px';
            container.style.height = '110px';
            
            let atkCard = document.createElement('div');
            atkCard.innerHTML = getCardHTML(pair.attack);
            atkCard.firstElementChild.style.position = 'absolute';
            atkCard.firstElementChild.style.top = '0';
            container.appendChild(atkCard.firstElementChild);
            
            if (pair.defense) {
                let defCard = document.createElement('div');
                defCard.innerHTML = getCardHTML(pair.defense);
                defCard.firstElementChild.style.position = 'absolute';
                defCard.firstElementChild.style.top = '20px';
                defCard.firstElementChild.style.left = '10px';
                defCard.firstElementChild.style.zIndex = '10';
                container.appendChild(defCard.firstElementChild);
            }
            playArea.appendChild(container);
        });
    }

    // Render deck and trump
    const deckSizeStr = GAME.isHost ? GAME.deck.length : GAME.deckSize;
    document.getElementById('cards-left').textContent = deckSizeStr;
    const trumpBox = document.getElementById('trump-card');
    trumpBox.innerHTML = GAME.trump && deckSizeStr > 0 ? getCardHTML(GAME.trump) : '';
    
    document.getElementById('deck-pile').style.display = deckSizeStr > 0 ? 'block' : 'none';

    // Buttons
    document.getElementById('btn-take').classList.toggle('hidden', myRole === 'Attacker' || !isMyTurn || GAME.table.length === 0);
    document.getElementById('btn-pass').classList.toggle('hidden', myRole === 'Defender' || !isMyTurn || GAME.table.length === 0);
}

function attemptPlayCard(card) {
    if (GAME.isHost) {
        handleAction({ type: 'PLAY', cardId: card.id }, 'host');
    } else {
        sendMsg('ACTION', { type: 'PLAY', cardId: card.id });
    }
}

document.getElementById('btn-take').addEventListener('click', () => {
    if (GAME.isHost) handleAction({ type: 'TAKE' }, 'host');
    else sendMsg('ACTION', { type: 'TAKE' });
});

document.getElementById('btn-pass').addEventListener('click', () => {
    if (GAME.isHost) handleAction({ type: 'PASS' }, 'host');
    else sendMsg('ACTION', { type: 'PASS' });
});


