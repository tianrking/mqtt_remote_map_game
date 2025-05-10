import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css'; // 确保导入的是 app_css_fullscreen_v3 中的 CSS
import mqtt from 'mqtt'; // Corrected MQTT import

// --- MQTT 配置 ---
// 使用 EMQX 公共 Broker (非加密 WebSocket)
const MQTT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'; // WebSocket Port for EMQX public broker
// !!! 请根据您的实际情况替换为您发布 GPS 数据的主题 !!!
const GPS_DATA_TOPIC = 'user/gps/realtime_track'; // 示例主题，请确保您的发布者使用此主题

// 地图显示组件
const MapDisplay = () => {
    const mapRef = useRef(null);
    const leafletMapRef = useRef(null);
    const tileLayerRef = useRef(null);
    const mqttClientRef = useRef(null); // 引用 MQTT 客户端实例
    const gpsMarkerRef = useRef(null); // 引用 GPS 标记实例
    const trackPolylineRef = useRef(null); // 引用轨迹线实例

    const [isLoading, setIsLoading] = useState(true); // 地图瓦片加载状态
    const [mqttStatus, setMqttStatus] = useState('未连接'); // MQTT 连接状态
    const [currentPosition, setCurrentPosition] = useState(null); // 当前 GPS 位置 {lat, lng}
    const [trackCoordinates, setTrackCoordinates] = useState([]); // 存储轨迹坐标 [[lat, lng], ...]

    // 地图配置常量
    const chengduCoordinates = [30.6578, 104.0658];
    const initialZoom = 12;
    const minZoomLevel = 6;
    const maxZoomLevel = 18;
    const tileUrl = 'http://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}&key=d710f9736c71e3f8c5bb3ce7e1ac2116';

    // 初始化地图的 useEffect
    useEffect(() => {
        if (mapRef.current && !leafletMapRef.current) {
            setIsLoading(true);
            leafletMapRef.current = L.map(mapRef.current, {
                center: chengduCoordinates,
                zoom: initialZoom,
                minZoom: minZoomLevel,
                maxZoom: maxZoomLevel,
                attributionControl: false,
            });
            const mapInstance = leafletMapRef.current;
            tileLayerRef.current = L.tileLayer(tileUrl, {
                attribution: '高德地图',
                minZoom: minZoomLevel,
                maxZoom: maxZoomLevel,
            });
            const currentTileLayer = tileLayerRef.current;
            currentTileLayer.on('loading', () => setIsLoading(true));
            currentTileLayer.on('load', () => setIsLoading(false));
            currentTileLayer.on('tileerror', () => setIsLoading(false));
            currentTileLayer.addTo(mapInstance);
            L.control.scale({ imperial: false, metric: true }).addTo(mapInstance);
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

    // 初始化和管理 MQTT 连接的 useEffect
    useEffect(() => {
        if (!mqttClientRef.current) {
            setMqttStatus('连接中...');
            const options = {
                // clientId: 'mqttjs_' + Math.random().toString(16).substr(2, 8),
                // username: 'your_username',
                // password: 'your_password',
            };
            const client = mqtt.connect(MQTT_BROKER_URL, options);
            mqttClientRef.current = client;

            client.on('connect', () => {
                setMqttStatus('已连接');
                console.log('MQTT 连接成功!');
                client.subscribe(GPS_DATA_TOPIC, { qos: 0 }, (err) => {
                    if (!err) {
                        console.log(`成功订阅主题: ${GPS_DATA_TOPIC}`);
                    } else {
                        console.error('订阅失败:', err);
                        setMqttStatus(`订阅失败: ${err.message}`);
                    }
                });
            });

            client.on('message', (topic, payload) => {
                console.log(`收到消息 主题: ${topic}, 内容: ${payload.toString()}`);
                if (topic === GPS_DATA_TOPIC) {
                    try {
                        const message = JSON.parse(payload.toString());
                        if (message && typeof message.lat === 'number' && typeof message.lng === 'number') {
                            const newPosition = { lat: message.lat, lng: message.lng };
                            setCurrentPosition(newPosition);
                            setTrackCoordinates(prevCoords => {
                                const updatedCoords = [...prevCoords, [newPosition.lat, newPosition.lng]];
                                // if (updatedCoords.length > 100) {
                                //     return updatedCoords.slice(updatedCoords.length - 100);
                                // }
                                return updatedCoords;
                            });
                        } else {
                            console.warn('收到的 GPS 数据格式不正确或缺少经纬度:', message);
                        }
                    } catch (e) {
                        console.error('解析 GPS 数据失败:', e);
                    }
                }
            });

            client.on('error', (err) => {
                console.error('MQTT 连接错误:', err);
                setMqttStatus(`连接错误`);
            });

            client.on('reconnect', () => {
                setMqttStatus('重新连接中...');
                console.log('MQTT 正在重新连接...');
            });

            client.on('close', () => {
                setMqttStatus('连接已断开');
                console.log('MQTT 连接已断开');
            });

             client.on('offline', () => {
                setMqttStatus('已离线');
                console.log('MQTT 客户端已离线');
            });
        }

        return () => {
            if (mqttClientRef.current && mqttClientRef.current.connected) {
                console.log('正在断开 MQTT 连接...');
                mqttClientRef.current.end(true, (error) => {
                     if (error) {
                        console.error('断开 MQTT 连接时出错:', error);
                     } else {
                        console.log('MQTT 连接已成功断开');
                     }
                     mqttClientRef.current = null;
                });
            } else if (mqttClientRef.current) {
                // If client exists but is not connected (e.g. in reconnection state)
                // still try to end it and clean up.
                try {
                    mqttClientRef.current.end(true);
                } catch (e) {
                    console.warn("Error ending non-connected MQTT client:", e);
                }
                mqttClientRef.current = null;
            }
        };
    }, []);

    // 更新地图上的标记和轨迹线的 useEffect
    useEffect(() => {
        if (!leafletMapRef.current || !currentPosition) return;

        const mapInstance = leafletMapRef.current;
        const latLng = [currentPosition.lat, currentPosition.lng];

        if (gpsMarkerRef.current) {
            gpsMarkerRef.current.setLatLng(latLng);
        } else {
            const customIcon = L.icon({
                iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
                iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });
            gpsMarkerRef.current = L.marker(latLng, { icon: customIcon }).addTo(mapInstance);
            gpsMarkerRef.current.bindPopup("实时位置");
        }
        
        // Ensure the marker is in view, if not, pan to it.
        // Also, if the zoom is too far out, zoom in.
        if (!mapInstance.getBounds().contains(latLng)) {
             mapInstance.setView(latLng, Math.max(mapInstance.getZoom(), 15)); // Ensure zoom is at least 15
        } else if (mapInstance.getZoom() < 10) { // If marker is in bounds but zoom is too low
            mapInstance.setZoom(10);
        }


        if (trackCoordinates.length >= 1) { // Polyline needs at least one point to be added/updated
            if (trackPolylineRef.current) {
                trackPolylineRef.current.setLatLngs(trackCoordinates);
            } else {
                trackPolylineRef.current = L.polyline(trackCoordinates, { color: 'blue', weight: 4, opacity: 0.7 }).addTo(mapInstance);
            }
        }

    }, [currentPosition, trackCoordinates]);

    return (
        <div className="map-container-wrapper">
            <div ref={mapRef} className="map-element"></div>
            {isLoading && <div className="loader"></div>}
            <div style={{
                position: 'absolute',
                top: '10px',
                left: '50px', // Adjusted to give space for Leaflet's default zoom control
                zIndex: 1000, // Ensure it's above map controls
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                padding: '6px 12px',
                borderRadius: '4px',
                boxShadow: '0 1px 5px rgba(0,0,0,0.2)',
                fontSize: '13px',
                fontWeight: 'bold',
                // Dynamically set text color based on MQTT status for better visibility
                color: mqttStatus === '已连接' ? 'green' : (mqttStatus.includes('错误') || mqttStatus.includes('失败') || mqttStatus === '连接已断开' || mqttStatus === '已离线' ? 'red' : 'darkorange'),
            }}>
                MQTT: {mqttStatus}
            </div>
        </div>
    );
};

// 主应用组件 App
function App() {
    let brokerHost = 'N/A';
    try {
        // Safely parse the MQTT_BROKER_URL to extract the hostname
        const url = new URL(MQTT_BROKER_URL);
        brokerHost = url.hostname;
    } catch (e) {
        console.error("无法解析 MQTT Broker URL:", MQTT_BROKER_URL);
        // Attempt to extract hostname using a simpler method if URL parsing fails
        const hostMatch = MQTT_BROKER_URL.match(/:\/\/([^:/]+)/);
        if (hostMatch && hostMatch[1]) {
            brokerHost = hostMatch[1];
        }
    }

    return (
        <div className="main-container">
            <header className="map-header">
                <h1 className="map-title">探索成都 - 实时轨迹</h1>
                <p className="map-subtitle">自定义高德瓦片地图 </p>
            </header>
            <MapDisplay />
            <footer className="map-footer">
                <p>MQTT Broker: {brokerHost} (ws)</p> {/* 明确指出使用 ws */}
                <p>GPS Topic: {GPS_DATA_TOPIC}</p>
                <p>地图数据来源: 高德地图</p>
                <p>使用 Leaflet.js, React, MQTT.js 构建</p>
            </footer>
        </div>
    );
}

export default App;
