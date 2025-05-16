const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Store previous states for undo functionality
let history = [];
const MAX_HISTORY = 20;

let scoreData = {
    matchName: "Cricket World Cup 2025",
    matchVenue: "Melbourne Cricket Ground",
    matchType: "T20",
    battingTeam: {
        name: "Team 1",
        logo: "",
        runs: 0,
        wickets: 0,
        overs: 0,
        balls: 0,
        target: null
    },
    bowlingTeam: {
        name: "Team 2",
        logo: ""
    },
    batsmen: [
        { name: "Batsman 1", runs: 0, balls: 0, fours: 0, sixes: 0, onStrike: true },
        { name: "Batsman 2", runs: 0, balls: 0, fours: 0, sixes: 0, onStrike: false }
    ],
    bowler: { name: "Bowler", overs: 0, balls: 0, runs: 0, wickets: 0 },
    currentOver: [],
    requiredRunRate: null
};

// Save current state to history
function saveState() {
    history.push(JSON.parse(JSON.stringify(scoreData)));
    if (history.length > MAX_HISTORY) {
        history.shift(); // Remove oldest state if we exceed max history
    }
}

// Undo last action
function undoLastAction() {
    if (history.length > 0) {
        scoreData = history.pop();
        broadcastUpdate();
    }
}

wss.on('connection', function connection(ws) {
    console.log('New client connected');
    
    // Send current data to new client
    ws.send(JSON.stringify({ type: 'init', data: scoreData }));
    
    ws.on('message', function incoming(message) {
        console.log('received: %s', message);
        const data = JSON.parse(message);
        
        // Save state before making changes (except for undo)
        if (data.type !== 'undo') {
            saveState();
        }
        
        switch(data.type) {
            case 'runs':
                addRuns(data.value);
                break;
            case 'wicket':
                addWicket();
                break;
            case 'extras':
                addExtras(data.value);
                break;
            case 'rotate':
                rotateStrike();
                break;
            case 'over':
                completeOver();
                break;
            case 'updateTeams':
                updateTeamDetails(data);
                break;
            case 'updatePlayers':
                updatePlayerDetails(data);
                break;
            case 'setTarget':
                setTarget(data.value);
                break;
            case 'undo':
                undoLastAction();
                break;
        }
    });
});

function broadcastUpdate() {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', data: scoreData }));
        }
    });
}

function addRuns(runs) {
    scoreData.battingTeam.runs += runs;
    
    const strikerIndex = scoreData.batsmen[0].onStrike ? 0 : 1;
    scoreData.batsmen[strikerIndex].runs += runs;
    scoreData.batsmen[strikerIndex].balls += 1;
    
    if (runs === 4) scoreData.batsmen[strikerIndex].fours += 1;
    if (runs === 6) scoreData.batsmen[strikerIndex].sixes += 1;
    
    scoreData.bowler.runs += runs;
    scoreData.bowler.balls += 1;
    scoreData.battingTeam.balls += 1;
    
    scoreData.currentOver.push({ type: 'runs', value: runs });
    
    if (runs % 2 === 1) rotateStrike();
    
    broadcastUpdate();
}

function addWicket() {
    scoreData.battingTeam.wickets += 1;
    const strikerIndex = scoreData.batsmen[0].onStrike ? 0 : 1;
    scoreData.batsmen[strikerIndex].balls += 1;
    scoreData.bowler.wickets += 1;
    scoreData.bowler.balls += 1;
    scoreData.battingTeam.balls += 1;
    
    scoreData.currentOver.push({ type: 'wicket' });
    
    broadcastUpdate();
}

function addExtras(type) {
    let runsToAdd = 1;
    
    switch(type) {
        case 'wide':
        case 'no-ball':
            runsToAdd = 1;
            break;
        case 'bye':
        case 'leg-bye':
            runsToAdd = 1;
            break;
    }
    
    scoreData.battingTeam.runs += runsToAdd;
    scoreData.bowler.runs += runsToAdd;
    
    scoreData.currentOver.push({ type: 'extras', value: type });
    
    // Only increment balls for regular deliveries (not for any extras)
    // Wides, no-balls, byes, and leg-byes don't count as balls
    // So we don't increment balls for any extras
    
    broadcastUpdate();
}

function rotateStrike() {
    scoreData.batsmen[0].onStrike = !scoreData.batsmen[0].onStrike;
    scoreData.batsmen[1].onStrike = !scoreData.batsmen[1].onStrike;
    broadcastUpdate();
}

function completeOver() {
    // Only rotate strike if an actual ball was bowled (not just extras)
    if (scoreData.currentOver.some(ball => ball.type === 'runs' || ball.type === 'wicket')) {
        rotateStrike();
    }
    
    // Reset the current over
    scoreData.currentOver = [];
    
    // Update bowler's over count
    scoreData.bowler.overs = Math.floor(scoreData.bowler.balls / 6);
    
    broadcastUpdate();
}

function updateTeamDetails(data) {
    scoreData.battingTeam.name = data.battingTeam.name;
    scoreData.battingTeam.logo = data.battingTeam.logo || "";
    scoreData.bowlingTeam.name = data.bowlingTeam.name;
    scoreData.bowlingTeam.logo = data.bowlingTeam.logo || "";
    scoreData.matchName = data.matchName;
    scoreData.matchVenue = data.matchVenue;
    scoreData.matchType = data.matchType;
    broadcastUpdate();
}

function updatePlayerDetails(data) {
    scoreData.batsmen[0].name = data.batsman1;
    scoreData.batsmen[1].name = data.batsman2;
    scoreData.bowler.name = data.bowler;
    
    if (data.striker === data.batsman1) {
        scoreData.batsmen[0].onStrike = true;
        scoreData.batsmen[1].onStrike = false;
    } else {
        scoreData.batsmen[0].onStrike = false;
        scoreData.batsmen[1].onStrike = true;
    }
    broadcastUpdate();
}

function setTarget(target) {
    scoreData.battingTeam.target = target;
    
    // Calculate required run rate if target is set
    if (target) {
        const ballsRemaining = 120 - scoreData.battingTeam.balls;
        const runsNeeded = target - scoreData.battingTeam.runs;
        if (ballsRemaining > 0 && runsNeeded > 0) {
            scoreData.requiredRunRate = (runsNeeded / ballsRemaining) * 6;
        } else {
            scoreData.requiredRunRate = null;
        }
    } else {
        scoreData.requiredRunRate = null;
    }
    
    broadcastUpdate();
}

console.log('WebSocket server running on ws://localhost:8080');