// src/App.jsx (o donde esté este componente)
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css'; // Asegúrate de importar el CSS de app_css_fullscreen_v3
import mqtt from 'mqtt'; // Importación MQTT corregida

// --- Configuración MQTT ---
// Usando el Broker público de EMQX (WebSocket no cifrado)
const MQTT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'; // Puerto WebSocket para el broker público de EMQX
// !!! ¡¡¡ Reemplaza con tu tema de publicación de datos GPS según tu situación real !!!
const GPS_DATA_TOPIC = 'user/gps/realtime_track'; // Tema de ejemplo, asegúrate de que tu publicador use este tema

// Componente de visualización del mapa
const MapDisplay = () => {
    const mapRef = useRef(null);
    const leafletMapRef = useRef(null);
    const tileLayerRef = useRef(null);
    const mqttClientRef = useRef(null); // Referencia a la instancia del cliente MQTT
    const gpsMarkerRef = useRef(null); // Referencia a la instancia del marcador GPS
    const trackPolylineRef = useRef(null); // Referencia a la instancia de la polilínea de seguimiento

    const [isLoading, setIsLoading] = useState(true); // Estado de carga de las teselas del mapa
    const [mqttStatus, setMqttStatus] = useState('Desconectado'); // Estado de la conexión MQTT
    const [currentPosition, setCurrentPosition] = useState(null); // Posición GPS actual {lat, lng}
    const [trackCoordinates, setTrackCoordinates] = useState([]); // Almacenar coordenadas de la ruta [[lat, lng], ...]

    // Constantes de configuración del mapa
    const chengduCoordinates = [30.6578, 104.0658];
    const initialZoom = 12;
    const minZoomLevel = 6;
    const maxZoomLevel = 18;
    // URL de teselas de ejemplo (Gaode/Amap). Podrías necesitar una clave o usar otra fuente.
    const tileUrl = 'http://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}&key=d710f9736c71e3f8c5bb3ce7e1ac2116'; // Nota: lang=zh_cn es para chino. Para español sería lang=es. Sin embargo, Amap podría no tener teselas en español. OpenStreetMap es una alternativa global: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

    // useEffect para inicializar el mapa
    useEffect(() => {
        if (mapRef.current && !leafletMapRef.current) {
            setIsLoading(true);
            leafletMapRef.current = L.map(mapRef.current, {
                center: chengduCoordinates,
                zoom: initialZoom,
                minZoom: minZoomLevel,
                maxZoom: maxZoomLevel,
                attributionControl: false, // El control de atribución se puede añadir manualmente o dejarlo si la fuente de teselas lo requiere
            });
            const mapInstance = leafletMapRef.current;
            tileLayerRef.current = L.tileLayer(tileUrl, {
                attribution: 'Mapa de Gaode', // Atribución para el mapa
                minZoom: minZoomLevel,
                maxZoom: maxZoomLevel,
            });
            const currentTileLayer = tileLayerRef.current;
            currentTileLayer.on('loading', () => setIsLoading(true));
            currentTileLayer.on('load', () => setIsLoading(false));
            currentTileLayer.on('tileerror', () => setIsLoading(false)); // Considera un manejo de error más robusto
            currentTileLayer.addTo(mapInstance);
            L.control.scale({ imperial: false, metric: true }).addTo(mapInstance); // Control de escala
            mapInstance.on('load', () => {
                if (currentTileLayer && !currentTileLayer.isLoading()) setIsLoading(false);
            });
            const handleResize = () => mapInstance && mapInstance.invalidateSize();
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('resize', handleResize);
                if (mapInstance) mapInstance.remove();
                leafletMapRef.current = null;
            };
        }
    }, []);

    // useEffect para inicializar y gestionar la conexión MQTT
    useEffect(() => {
        if (!mqttClientRef.current) {
            setMqttStatus('Conectando...');
            const options = {
                // clientId: 'mqttjs_' + Math.random().toString(16).substr(2, 8), // ID de cliente único
                // username: 'tu_usuario', // Descomentar y usar si es necesario
                // password: 'tu_contraseña', // Descomentar y usar si es necesario
            };
            const client = mqtt.connect(MQTT_BROKER_URL, options);
            mqttClientRef.current = client;

            client.on('connect', () => {
                setMqttStatus('Conectado');
                console.log('¡Conexión MQTT exitosa!');
                client.subscribe(GPS_DATA_TOPIC, { qos: 0 }, (err) => {
                    if (!err) {
                        console.log(`Suscripción exitosa al tema: ${GPS_DATA_TOPIC}`);
                    } else {
                        console.error('Suscripción fallida:', err);
                        setMqttStatus(`Suscripción fallida: ${err.message}`);
                    }
                });
            });

            client.on('message', (topic, payload) => {
                console.log(`Mensaje recibido - Tema: ${topic}, Contenido: ${payload.toString()}`);
                if (topic === GPS_DATA_TOPIC) {
                    try {
                        const message = JSON.parse(payload.toString());
                        if (message && typeof message.lat === 'number' && typeof message.lng === 'number') {
                            const newPosition = { lat: message.lat, lng: message.lng };
                            setCurrentPosition(newPosition);
                            setTrackCoordinates(prevCoords => {
                                const updatedCoords = [...prevCoords, [newPosition.lat, newPosition.lng]];
                                // Opcional: Limitar el número de puntos en la ruta para mejorar el rendimiento
                                // if (updatedCoords.length > 100) { // Por ejemplo, mantener los últimos 100 puntos
                                //     return updatedCoords.slice(updatedCoords.length - 100);
                                // }
                                return updatedCoords;
                            });
                        } else {
                            console.warn('Formato de datos GPS recibido incorrecto o faltan latitud/longitud:', message);
                        }
                    } catch (e) {
                        console.error('Error al analizar datos GPS:', e);
                    }
                }
            });

            client.on('error', (err) => {
                console.error('Error de conexión MQTT:', err);
                setMqttStatus(`Error de conexión`); // O un mensaje más específico: `Error de conexión: ${err.message}`
            });

            client.on('reconnect', () => {
                setMqttStatus('Reconectando...');
                console.log('MQTT reconectando...');
            });

            client.on('close', () => {
                setMqttStatus('Conexión cerrada');
                console.log('Conexión MQTT cerrada');
            });

             client.on('offline', () => {
                setMqttStatus('Fuera de línea');
                console.log('Cliente MQTT fuera de línea');
            });
        }

        return () => {
            if (mqttClientRef.current && mqttClientRef.current.connected) {
                console.log('Desconectando la conexión MQTT...');
                mqttClientRef.current.end(true, (error) => { // El segundo argumento 'true' fuerza el cierre
                     if (error) {
                        console.error('Error al cerrar la conexión MQTT:', error);
                     } else {
                        console.log('Conexión MQTT cerrada exitosamente');
                     }
                     mqttClientRef.current = null; // Limpiar referencia
                });
            } else if (mqttClientRef.current) {
                // Si el cliente existe pero no está conectado (p.ej., en estado de reconexión)
                // intentar cerrarlo y limpiar.
                try {
                    mqttClientRef.current.end(true);
                } catch (e) {
                    console.warn("Error al cerrar cliente MQTT no conectado:", e);
                }
                mqttClientRef.current = null;
            }
        };
    }, []); // El array vacío asegura que esto se ejecute solo al montar/desmontar

    // useEffect para actualizar marcadores y polilínea en el mapa
    useEffect(() => {
        if (!leafletMapRef.current || !currentPosition) return;

        const mapInstance = leafletMapRef.current;
        const latLng = [currentPosition.lat, currentPosition.lng];

        // Actualizar o crear marcador GPS
        if (gpsMarkerRef.current) {
            gpsMarkerRef.current.setLatLng(latLng);
        } else {
            const customIcon = L.icon({ // Icono personalizado
                iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
                iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });
            gpsMarkerRef.current = L.marker(latLng, { icon: customIcon }).addTo(mapInstance);
            gpsMarkerRef.current.bindPopup("Ubicación en tiempo real"); // Popup del marcador
        }
        
        // Asegurar que el marcador esté a la vista, si no, centrar el mapa en él.
        // Además, si el zoom está muy alejado, acercar.
        if (!mapInstance.getBounds().contains(latLng)) {
             mapInstance.setView(latLng, Math.max(mapInstance.getZoom(), 15)); // Asegurar que el zoom sea al menos 15
        } else if (mapInstance.getZoom() < 10) { // Si el marcador está dentro de los límites pero el zoom es muy bajo
            mapInstance.setZoom(10); // Acercar a un nivel de zoom mínimo razonable
        }

        // Actualizar o crear polilínea de seguimiento
        if (trackCoordinates.length >= 1) { // La polilínea necesita al menos un punto para ser añadida/actualizada
            if (trackPolylineRef.current) {
                trackPolylineRef.current.setLatLngs(trackCoordinates);
            } else {
                trackPolylineRef.current = L.polyline(trackCoordinates, { color: 'blue', weight: 4, opacity: 0.7 }).addTo(mapInstance);
            }
        }

    }, [currentPosition, trackCoordinates]); // Dependencias: se ejecuta cuando currentPosition o trackCoordinates cambian

    return (
        <div className="map-container-wrapper"> {/* Contenedor para el mapa y superposiciones */}
            <div ref={mapRef} className="map-element"></div> {/* Elemento donde se renderizará el mapa */}
            {isLoading && <div className="loader"></div>} {/* Indicador de carga */}
            <div style={{
                position: 'absolute',
                top: '10px',
                left: '50px', // Ajustado para dar espacio al control de zoom predeterminado de Leaflet
                zIndex: 1000, // Asegurar que esté por encima de los controles del mapa
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                padding: '6px 12px',
                borderRadius: '4px',
                boxShadow: '0 1px 5px rgba(0,0,0,0.2)',
                fontSize: '13px',
                fontWeight: 'bold',
                // Establecer dinámicamente el color del texto según el estado de MQTT para una mejor visibilidad
                color: mqttStatus === 'Conectado' ? 'green' : (mqttStatus.includes('Error') || mqttStatus.includes('fallida') || mqttStatus === 'Conexión cerrada' || mqttStatus === 'Fuera de línea' ? 'red' : 'darkorange'),
            }}>
                MQTT: {mqttStatus}
            </div>
        </div>
    );
};

// Componente principal de la aplicación App
function App() {
    let brokerHost = 'N/A';
    try {
        // Analizar de forma segura la URL del Broker MQTT para extraer el nombre de host
        const url = new URL(MQTT_BROKER_URL);
        brokerHost = url.hostname;
    } catch (e) {
        console.error("No se pudo analizar la URL del Broker MQTT:", MQTT_BROKER_URL);
        // Intentar extraer el nombre de host usando un método más simple si el análisis de URL falla
        const hostMatch = MQTT_BROKER_URL.match(/:\/\/([^:/]+)/);
        if (hostMatch && hostMatch[1]) {
            brokerHost = hostMatch[1];
        }
    }

    return (
        <div className="main-container">
            <header className="map-header">
                <h1 className="map-title">Explora Chengdu - Seguimiento en Tiempo Real</h1>
                <p className="map-subtitle">Mapa de teselas personalizado de Gaode</p>
            </header>
            <MapDisplay />
            <footer className="map-footer">
                {/* Ejemplos de información para el pie de página, descomentar y adaptar si es necesario */}
                {/* <p>Broker MQTT: {brokerHost} (wss)</p>  */}
                {/* Indica explícitamente el uso de wss si es el caso */}
                {/* <p>Tema GPS: {GPS_DATA_TOPIC}</p>
                <p>Fuente de datos del mapa: Mapa de Gaode</p>
                <p>Construido con Leaflet.js, React, MQTT.js</p> */}
            </footer>
        </div>
    );
}

export default App;