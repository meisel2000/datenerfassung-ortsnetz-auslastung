/*
 * Ortsnetz-Auslastung for MQTT
 * Version: 0.3.0
 *
 * Requires Node.js >= 18 and the npm package "mqtt".
 */

const mqtt = require('mqtt');

const CONFIG = {
    latitude: 51.264724,
    longitude: 6.557062,
    brokerUrl: 'mqtt://k9s:31883',
    username: '',
    password: '',
    l1Topic: 'mbmd/sdm1-1/Voltage/L1',
    l2Topic: 'mbmd/sdm1-1/Voltage/L2',
    l3Topic: 'mbmd/sdm1-1/Voltage/L3',
    frequencyTopic: 'mbmd/sdm1-1/Frequency', // optional: set to '' when unavailable
    jsonKey: '', // optional: key inside a JSON payload, e.g. 'value' or 'data.voltage'
    maxValueAgeMs: 1 * 60 * 1000,
    uploadIntervalMs: 5 * 60 * 1000,
    smartmeterModel: 'SDM630',
    plant_capacity_kwp: 5.81 + 1.6, // in kWp
    solarForecastTopic: 'evcc/site/forecast/solar',
    solarForecastJsonKey: 'today.energy'
};

const API_URL = 'https://www.ortsnetz-auslastung.de/v1/measurements';
const VERSION = 'mqtt-0.3.0';

const values = new Map();
let pvForecastKwh = 0;

function parsePayload(payload, jsonKey = CONFIG.jsonKey) {
    const text = payload.toString().trim();
    const direct = Number(text);

    if (Number.isFinite(direct)) {
        return direct;
    }

    try {
        const parsed = JSON.parse(text);
        const picked = jsonKey
            ? jsonKey.split('.').reduce((node, key) => (node == null ? undefined : node[key]), parsed)
            : parsed;

        return Number(picked);
    } catch {
        return NaN;
    }
}

function currentValue(topic) {
    const entry = values.get(topic);

    if (!entry || Date.now() - entry.receivedAt > CONFIG.maxValueAgeMs) {
        return null;
    }

    return entry.value;
}

function schedulePvForecastUpdate() {
    const now = new Date();
    const nextUpdate = new Date(now);
    nextUpdate.setHours(24, 1, 0, 0);

    setTimeout(() => {
        const forecast = currentValue(CONFIG.solarForecastTopic);

        if (Number.isFinite(forecast) && forecast >= 0) {
            pvForecastKwh = forecast / 1000;
            uploadMeasurement();
        } else {
            console.warn('Ortsnetz-Auslastung: keine gültige PV-Prognose um 00:01 Uhr');
        }

        schedulePvForecastUpdate();
    }, nextUpdate.getTime() - now.getTime());
}

async function uploadMeasurement() {
    const l1 = currentValue(CONFIG.l1Topic);
    const l2 = currentValue(CONFIG.l2Topic);
    const l3 = currentValue(CONFIG.l3Topic);
    const frequency = CONFIG.frequencyTopic ? currentValue(CONFIG.frequencyTopic) : null;
    // Do not report missing or implausible measurements.
    if (![l1, l2, l3].every((value) => Number.isFinite(value) && value >= 150 && value <= 300)) {
        console.warn('Ortsnetz-Auslastung: ungültige Spannung; Upload übersprungen');
        return;
    }

    const payload = {
        observed_at: new Date().toISOString(),
        latitude: CONFIG.latitude,
        longitude: CONFIG.longitude,
        l1_v: l1,
        l2_v: l2,
        l3_v: l3,
        integration_version: VERSION,
        smartmeter_model: CONFIG.smartmeterModel,
        plant_capacity_kwp: CONFIG.plant_capacity_kwp,
    };

    if (pvForecastKwh > 0) {
        payload.pv_forecast_kwh = pvForecastKwh;
    }

    if (Number.isFinite(frequency) && frequency >= 45 && frequency <= 55) {
        payload.grid_frequency_hz = frequency;
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
        });

        const body = await response.text();

        if (response.status === 202) {
            console.log(`Ortsnetz-Auslastung: Upload angenommen: ${body}`);

            let overall;
            try {
                overall = JSON.parse(body)?.status?.overall;
            } catch {
                overall = undefined;
            }

            if (overall === 'yellow') {
                console.warn('Ortsnetz-Auslastung: Ampelstatus gelb');
            }
        } else {
            console.warn(`Ortsnetz-Auslastung: unerwarteter HTTP-Status ${response.status}: ${body}`);
        }
    } catch (error) {
        console.warn(`Ortsnetz-Auslastung: Upload fehlgeschlagen: ${error}`);
    }
}

const topics = [CONFIG.l1Topic, CONFIG.l2Topic, CONFIG.l3Topic, CONFIG.frequencyTopic, CONFIG.solarForecastTopic].filter(Boolean);

const client = mqtt.connect(CONFIG.brokerUrl, {
    username: CONFIG.username || undefined,
    password: CONFIG.password || undefined,
    reconnectPeriod: 5000,
});

client.on('connect', () => {
    client.subscribe(topics, (error) => {
        if (error) {
            console.warn(`Ortsnetz-Auslastung: Abonnement fehlgeschlagen: ${error}`);
        }
    });
    console.warn('Ortsnetz-Auslastung: MQTT verbunden');
    uploadMeasurement(); // Direkt nach der Verbindung eine Messung hochladen
});

client.on('error', (error) => {
    console.warn(`Ortsnetz-Auslastung: MQTT-Fehler: ${error}`);
});

client.on('message', (topic, payload) => {
    const jsonKey = topic === CONFIG.solarForecastTopic ? CONFIG.solarForecastJsonKey : CONFIG.jsonKey;
    const value = parsePayload(payload, jsonKey);

    if (Number.isFinite(value)) {
        values.set(topic, { value, receivedAt: Date.now() });
        console.info(`Ortsnetz-Auslastung: Wert aus ${topic} empfangen: ${value}`);
    } else {
        console.warn(`Ortsnetz-Auslastung: Wert aus ${topic} nicht lesbar`);
    }
});

// Alle fünf Minuten
setInterval(uploadMeasurement, CONFIG.uploadIntervalMs);

if (CONFIG.solarForecastTopic) {
    schedulePvForecastUpdate();
}
