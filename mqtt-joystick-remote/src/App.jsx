// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { Wifi, WifiOff, Settings, MapPin, Power } from 'lucide-react'; // Power para detener
import Joystick from './Joystick'; // Importar el componente Joystick
import './App.css'; // Estilos principales de la aplicación (usa el mismo App.css que la versión anterior del control remoto con botones)

// --- Configuración MQTT ---
const MQTT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const DEFAULT_COMMAND_TOPIC = 'user/gps/realtime_track'; // Tema por defecto, consistente con la aplicación de mapa

// --- Configuración de simulación GPS ---
const INITIAL_REMOTE_GPS_POSITION = { lat: 30.6578, lng: 104.0658 }; // Punto de inicio GPS interno del control remoto
const GPS_MOVE_STEP_MULTIPLIER = 0.001; // Factor multiplicador para el paso de GPS por movimiento del joystick (sensibilidad)
const MOVE_INTERVAL_DELAY = 150; // Intervalo de envío de comandos cuando el joystick está activo (milisegundos)

function App() {
  const [mqttClient, setMqttClient] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Desconectado');
  const [lastSentGps, setLastSentGps] = useState(null);
  const [commandTopic, setCommandTopic] = useState(DEFAULT_COMMAND_TOPIC);
  const [inputTopic, setInputTopic] = useState(DEFAULT_COMMAND_TOPIC);
  const [currentRemoteGps, setCurrentRemoteGps] = useState(INITIAL_REMOTE_GPS_POSITION);

  const commandQueueRef = useRef([]); // Cola de envío de comandos
  const isPublishingRef = useRef(false); // Bloqueo de estado de publicación
  const joystickMoveIntervalRef = useRef(null); // ID del temporizador para movimiento del joystick
  const currentJoystickDeltaRef = useRef({ x: 0, y: 0 }); // Desplazamiento actual x, y del joystick (normalizado)

  // Inicializar conexión MQTT
  useEffect(() => {
    console.log('Intentando conectar al Broker MQTT...');
    setConnectionStatus('Conectando...');
    const client = mqtt.connect(MQTT_BROKER_URL, {
      clientId: `mqtt-joystick-remote-${Math.random().toString(16).substr(2, 8)}`,
      connectTimeout: 5000,
      reconnectPeriod: 1000,
    });

    client.on('connect', () => {
      console.log('¡Conexión MQTT exitosa!');
      setConnectionStatus('Conectado');
      setMqttClient(client);
    });
    client.on('error', (err) => {
      console.error('Error de conexión MQTT:', err);
      setConnectionStatus(`Error de conexión`);
    });
    client.on('reconnect', () => {
      console.log('MQTT reconectando...');
      setConnectionStatus('Reconectando...');
    });
    client.on('close', () => {
      console.log('Conexión MQTT cerrada');
      setConnectionStatus('Desconectado'); // O 'Cerrada'
    });
    client.on('offline', () => {
      console.log('Cliente MQTT fuera de línea');
      setConnectionStatus('Fuera de línea');
    });

    // Desconectar y limpiar temporizador al desmontar el componente
    return () => {
      if (client) {
        client.end(true);
        console.log('Conexión MQTT cerrada (Control Remoto)');
      }
      if (joystickMoveIntervalRef.current) {
        clearInterval(joystickMoveIntervalRef.current);
      }
    };
  }, []);

  // Procesar la cola de envío de comandos
  const processCommandQueue = () => {
    if (isPublishingRef.current || commandQueueRef.current.length === 0 || !mqttClient || !mqttClient.connected) {
      return;
    }
    isPublishingRef.current = true;
    const gpsPayload = commandQueueRef.current.shift();
    mqttClient.publish(commandTopic, JSON.stringify(gpsPayload), { qos: 0, retain: false }, (error) => {
      if (error) {
        console.error(`Error al publicar datos GPS en el tema ${commandTopic}:`, error);
        setLastSentGps({ ...gpsPayload, topic: commandTopic, status: 'Envío fallido' });
      } else {
        console.log(`Datos GPS publicados en el tema ${commandTopic}: ${JSON.stringify(gpsPayload)}`);
        setLastSentGps({ ...gpsPayload, topic: commandTopic, status: 'Enviado con éxito' });
      }
      isPublishingRef.current = false;
      if (commandQueueRef.current.length > 0) {
        setTimeout(processCommandQueue, 50); // Darle a la red un pequeño respiro
      }
    });
  };

  // Calcular y enviar coordenadas GPS según el delta del joystick
  const sendGpsUpdateFromJoystick = () => {
    if (!commandTopic.trim()) {
      console.warn('El tema de datos GPS está vacío, no se puede enviar.');
      return;
    }
    // Actualizar y enviar GPS solo cuando el joystick se mueve realmente
    if (currentJoystickDeltaRef.current.x === 0 && currentJoystickDeltaRef.current.y === 0) {
      return;
    }

    setCurrentRemoteGps(prevGps => {
      let { lat, lng } = prevGps;
      // currentJoystickDeltaRef.current.y corresponde al cambio de latitud (joystick hacia arriba es positivo, corresponde al aumento de latitud GPS)
      // currentJoystickDeltaRef.current.x corresponde al cambio de longitud (joystick hacia derecha es positivo, corresponde al aumento de longitud GPS)
      lat += currentJoystickDeltaRef.current.y * GPS_MOVE_STEP_MULTIPLIER;
      lng += currentJoystickDeltaRef.current.x * GPS_MOVE_STEP_MULTIPLIER;

      // Limitar rango de latitud y longitud
      lat = Math.max(-90, Math.min(90, lat));
      lng = Math.max(-180, Math.min(180, lng));
      
      const newPosition = { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
      const gpsPayload = { ...newPosition, timestamp: Date.now() };

      commandQueueRef.current.push(gpsPayload);
      processCommandQueue();
      return newPosition; // Devolver nueva posición GPS para actualizar el estado interno del control remoto
    });
  };

  // Función de callback para el movimiento del joystick
  const handleJoystickChange = (delta) => { // delta = { x: normalizedX, y: normalizedY }
    currentJoystickDeltaRef.current = delta; // Actualizar desplazamiento actual del joystick

    // Si MQTT no está conectado, no iniciar el temporizador
    if (!mqttClient || !mqttClient.connected) return;

    if (delta.x !== 0 || delta.y !== 0) { // Si el joystick no está en el centro
      if (!joystickMoveIntervalRef.current) { // Si el temporizador no está iniciado, iniciarlo
        sendGpsUpdateFromJoystick(); // Enviar una actualización inmediatamente
        joystickMoveIntervalRef.current = setInterval(sendGpsUpdateFromJoystick, MOVE_INTERVAL_DELAY);
      }
    } else { // Si el joystick vuelve al centro (teóricamente onStop lo manejará, pero esto es como doble seguro)
      if (joystickMoveIntervalRef.current) {
        clearInterval(joystickMoveIntervalRef.current);
        joystickMoveIntervalRef.current = null;
      }
    }
  };

  // Función de callback para cuando el joystick se detiene (vuelve al centro)
  const handleJoystickStop = () => {
    if (joystickMoveIntervalRef.current) {
      clearInterval(joystickMoveIntervalRef.current);
      joystickMoveIntervalRef.current = null;
    }
    currentJoystickDeltaRef.current = { x: 0, y: 0 }; // Restablecer desplazamiento del joystick
    console.log('Joystick detenido, se detuvo el envío de datos GPS.');
    setLastSentGps({ action: "JOYSTICK_STOP", topic: commandTopic, status: "Ejecutado (envío detenido)" });
  };
  
  // Manejador de eventos para el botón de "Parada de Emergencia"
  const handleEmergencyStop = () => {
    handleJoystickStop(); // Llamar a la lógica de detención del joystick, limpiar temporizador
    // Aquí se puede enviar adicionalmente un comando de parada específico a MQTT, si el cliente del mapa necesita una señal de parada explícita
    // Por ejemplo: commandQueueRef.current.push({ type: "EMERGENCY_STOP", timestamp: Date.now() }); processCommandQueue();
    console.log('Botón de parada de emergencia presionado.');
    setLastSentGps({ action: "EMERGENCY_STOP", topic: commandTopic, status: "Ejecutado" });
  };

  // Función para manejar cambios en el input del tema
  const handleTopicInputChange = (event) => {
    setInputTopic(event.target.value);
  };

  // Aplicar el nuevo tema
  const handleSetTopic = () => {
    if (inputTopic.trim()) {
      setCommandTopic(inputTopic.trim());
      console.log(`Tema de comando actualizado a: ${inputTopic.trim()}`);
      alert(`Tema de comando actualizado a: ${inputTopic.trim()}`);
    } else {
      alert('¡El tema no puede estar vacío!');
    }
  };

  // Obtener la clase CSS correspondiente al estado de conexión
  const getStatusClass = () => {
    if (connectionStatus === 'Conectado') return 'status-connected';
    if (connectionStatus === 'Conectando...' || connectionStatus === 'Reconectando...') return 'status-connecting';
    return 'status-disconnected';
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Control Remoto GPS MQTT</h1>
        <p>Controlado con joystick analógico</p>
      </header>

      <div className="status-display">
        <div className={`status-text ${getStatusClass()}`}>
          {connectionStatus === 'Conectado' ? <Wifi size={18} className="icon" /> : <WifiOff size={18} className="icon" />}
          <span>{connectionStatus}</span>
        </div>
        {mqttClient && mqttClient.connected && lastSentGps && (
          <p className="last-command-text">
            {lastSentGps.action && lastSentGps.action.includes("STOP") ? 
             `Comando (${lastSentGps.topic}): ${lastSentGps.action} - ${lastSentGps.status}` :
             `GPS Anterior (${lastSentGps.topic}): Lat ${lastSentGps.lat?.toFixed(4)}, Lng ${lastSentGps.lng?.toFixed(4)} - ${lastSentGps.status}`
            }
          </p>
        )}
      </div>

      <div className="topic-config-section">
        <label htmlFor="topic-input" className="topic-label">Tema de datos GPS:</label>
        <input
          type="text"
          id="topic-input"
          value={inputTopic}
          onChange={handleTopicInputChange}
          placeholder="Ej: user/gps/realtime_track"
          className="topic-input"
          disabled={!mqttClient || !mqttClient.connected}
        />
        <button
          onClick={handleSetTopic}
          className="topic-set-button"
          disabled={!mqttClient || !mqttClient.connected || !inputTopic.trim()}
        >
          <Settings size={16} style={{ marginRight: '4px' }}/> Configurar
        </button>
      </div>
      
      <div className="current-gps-display">
        <MapPin size={16} className="icon" />
        Posición simulada del control: Lat {currentRemoteGps.lat.toFixed(4)}, Lng {currentRemoteGps.lng.toFixed(4)}
      </div>

      {/* Área de control del Joystick */}
      <div className="joystick-area">
        <Joystick
          size={180} // Tamaño de la base del joystick (px)
          stickSize={70} // Tamaño del stick del joystick (px)
          onChange={handleJoystickChange} // Se activa cuando el joystick se mueve
          onStop={handleJoystickStop}     // Se activa cuando el joystick se suelta y vuelve al centro
        />
      </div>
      
      {/* Botón de Parada de Emergencia */}
      <button 
        className="emergency-stop-button control-button stop-button" // Reutilizar estilos de botón anteriores
        onClick={handleEmergencyStop}
        disabled={!mqttClient || !mqttClient.connected}
        title="Detener todo movimiento de emergencia"
      >
        <Power size={24} /> Parada de Emergencia
      </button>

      <footer className="footer">
        <p>Broker: {MQTT_BROKER_URL.split('//')[1].split(':')[0]}</p>
        <p>Tema actual de datos GPS: {commandTopic}</p>
      </footer>
    </div>
  );
}

export default App;