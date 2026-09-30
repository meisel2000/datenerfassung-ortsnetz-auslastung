# Ortsnetz-Auslastung für MQTT

Ein eigenständiges Node.js-Script. Es abonniert drei Spannungs-Topics und optional ein Frequenz-Topic auf einem MQTT-Broker, prüft die Werte und übermittelt sie alle fünf Minuten per HTTPS an die Ortsnetz-Auslastung-API.

Geeignet für alle Smart-Meter-Gateways, die ihre Messwerte per MQTT veröffentlichen, zum Beispiel [mbmd](https://github.com/volkszaehler/mbmd), Tasmota, evcc oder Shelly.

## Voraussetzungen

- Node.js ab Version 24 oder Docker
- Ein erreichbarer MQTT-Broker mit L1-, L2- und L3-Spannung in Volt
- Internetzugang des ausführenden Hosts

## Installation

1. Repository klonen und in dieses Verzeichnis wechseln.
2. `npm install` ausführen.
3. Im `CONFIG`-Block von [ortsnetz-auslastung.js](ortsnetz-auslastung.js) `latitude`, `longitude`, `brokerUrl` und die Topics anpassen.
4. Falls keine Frequenz verfügbar ist, `frequencyTopic: ''` eintragen.
5. Falls keine PV-Prognose verfügbar ist, `solarForecastTopic: ''` eintragen.
6. `npm start` ausführen. Nach dem Verbinden erfolgt ein erster Upload, danach alle fünf Minuten.

Koordinaten lassen sich mit [OpenStreetMap](https://www.openstreetmap.org/) bestimmen: Standort suchen, Rechtsklick auf die Karte und **„Abfrage starten“** wählen.

## Konfiguration

| Feld | Beschreibung |
| --- | --- |
| `latitude`, `longitude` | Standort der Messung |
| `brokerUrl` | Broker-Adresse, z. B. `mqtt://broker:1883` oder `mqtts://broker:8883` |
| `username`, `password` | Zugangsdaten; leer lassen, wenn der Broker anonym erlaubt |
| `l1Topic`, `l2Topic`, `l3Topic` | Topics mit der Spannung je Phase in Volt |
| `frequencyTopic` | Topic mit der Netzfrequenz in Hertz; `''` wenn nicht vorhanden |
| `jsonKey` | Schlüssel innerhalb eines JSON-Payloads, z. B. `value` oder `data.voltage`; leer lassen bei reinen Zahlenwerten |
| `solarForecastTopic` | Optionales Topic mit der EVCC PV-Tagesprognose in Wh; `''` wenn nicht vorhanden |
| `solarForecastJsonKey` | Schlüssel innerhalb des JSON-Payloads der PV-Prognose, standardmäßig `today.energy` |
| `maxValueAgeMs` | Maximales Alter eines empfangenen Werts; ältere Werte gelten als fehlend |
| `uploadIntervalMs` | Abstand zwischen zwei Uploads |
| `smartmeterModel` | Freie Bezeichnung des Messgeräts |
| `plant_capacity_kwp` | Installierte PV-Leistung in kWp |

Beispiel:

```javascript
const CONFIG = {
    latitude: 52.520008,
    longitude: 13.404954,
    brokerUrl: 'mqtt://broker.local:1883',
    username: '',
    password: '',
    l1Topic: 'mbmd/sdm1-1/Voltage/L1',
    l2Topic: 'mbmd/sdm1-1/Voltage/L2',
    l3Topic: 'mbmd/sdm1-1/Voltage/L3',
    frequencyTopic: 'mbmd/sdm1-1/Frequency',
    jsonKey: '',
    solarForecastTopic: 'evcc/site/forecast/solar',
    solarForecastJsonKey: 'today.energy',
    maxValueAgeMs: 1 * 60 * 1000,
    uploadIntervalMs: 5 * 60 * 1000,
    smartmeterModel: 'SDM630',
    plant_capacity_kwp: 7.41,
};
```

Topics lassen sich vorab prüfen:

```bash
mosquitto_sub -h broker.local -p 1883 -v -t 'mbmd/#'
```

## Docker

```bash
npm run docker:build
npm run docker:tag
npm run docker:push
```

Das Ziel-Repository steht unter `config.imageRepo` in [package.json](package.json).

## Verhalten und Fehleranalyse

- Spannungswerte außerhalb von 150–300 V werden nicht übertragen.
- Die Frequenz wird nur gesendet, wenn sie zwischen 45 und 55 Hz liegt.
- Werte, die älter als `maxValueAgeMs` sind, gelten als fehlend; der Upload wird übersprungen.
- Die PV-Prognose wird in Wh per MQTT von evcc empfangen, einmal täglich um 00:01 Uhr aktualisiert und für die API in kWh umgerechnet.
- Die installierte PV-Leistung wird mit jedem Upload übertragen. `pv_forecast_kwh` wird erst übertragen, wenn eine positive PV-Prognose vorliegt; bis dahin fehlt das Feld im Payload.
- Übertragungen erhalten eine Zeitüberschreitung von 10 Sekunden.
- Meldet die API den Ampelstatus `yellow`, erscheint eine Warnung im Log.
- Bei `Wert aus … nicht lesbar` Topic-Payload prüfen und ggf. `jsonKey` setzen.

## API

```text
POST https://www.ortsnetz-auslastung.de/v1/measurements
Content-Type: application/json
```

Beispiel-Payload:

```json
{
  "observed_at": "2026-09-15T08:00:00.000Z",
  "latitude": 52.520008,
  "longitude": 13.404954,
  "l1_v": 230.1,
  "l2_v": 229.9,
  "l3_v": 230.4,
  "grid_frequency_hz": 50,
  "pv_forecast_kwh": 4.2,
  "plant_capacity_kwp": 7.41,
  "smartmeter_model": "SDM630",
  "integration_version": "mqtt-0.3.0"
}
```

Die API bestätigt angenommene Messungen mit HTTP `202`. Details siehe [API.md](../API.md).
