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
        hostCanvas: document.getElementById('host-qr-canvas'),
        joinCanvas: document.getElementById('join-qr-canvas')
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

function setupDataChannel(channel) {
    channel.onopen = () => {
        showToast("Connected!");
        showScreen('game');
        // startGameLogic();
    };
    channel.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log("Received:", msg);
        // handleGameMessage(msg);
    };
    channel.onclose = () => showToast("Disconnected.");
}

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
    els.steps.host2.classList.remove('active');
    
    peerConnection = new RTCPeerConnection(config);
    dataChannel = peerConnection.createDataChannel('durak');
    setupDataChannel(dataChannel);

    peerConnection.onicecandidate = async (event) => {
        if (event.candidate === null) {
            // Gathering complete, show QR
            const offerStr = JSON.stringify(peerConnection.localDescription);
            console.log("Offer len:", offerStr.length);
            try {
                await QRCode.toCanvas(els.qr.hostCanvas, offerStr, { width: 300 });
                els.steps.host1.classList.remove('active');
                els.steps.host2.classList.add('active');
            } catch (error) {
                console.error("QR formatting error:", error);
                showToast("Failed to generate QR Code");
            }
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
}

els.buttons.hostScanClient.addEventListener('click', () => {
    els.steps.host1.classList.remove('active');
    els.steps.host2.classList.remove('active');
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
    els.steps.host2.classList.add('active');
});

// ------ JOIN LOGIC ------ //
async function startJoining() {
    showScreen('join');
    els.steps.join1.classList.add('active');
    els.steps.join2.classList.remove('active');

    peerConnection = new RTCPeerConnection(config);
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

    startScanner('join-scanner', async (decodedText) => {
        try {
            const offer = JSON.parse(decodedText);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            peerConnection.onicecandidate = async (evt) => {
                if (evt.candidate === null) {
                    const answerStr = JSON.stringify(peerConnection.localDescription);
                    console.log("Answer len:", answerStr.length);
                    try {
                        await QRCode.toCanvas(els.qr.joinCanvas, answerStr, { width: 300 });
                        els.steps.join1.classList.remove('active');
                        els.steps.join2.classList.add('active');
                    } catch (err) {
                        console.error("Join QR Error:", err);
                        showToast("Failed to generate Answer QR");
                    }
                }
            };
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
        } catch(e) {
            console.error(e);
            showToast("Failed to parse Host's QR code");
        }
    });
}

// ------ BINDINGS ------ //
els.buttons.host.addEventListener('click', startHosting);
els.buttons.join.addEventListener('click', startJoining);

