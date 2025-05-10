// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { Wifi, WifiOff, Settings, MapPin, Power } from 'lucide-react'; // Power for stop
import Joystick from './Joystick'; // 导入摇杆组件
import './App.css'; // 主应用样式 (与之前的按钮版本遥控器使用相同的 App.css)

// --- MQTT 配置 ---
const MQTT_BROKER_URL = 'ws://broker.emqx.io:8083/mqtt';
const DEFAULT_COMMAND_TOPIC = 'user/gps/realtime_track'; // 默认主题，与地图应用一致

// --- GPS 模拟配置 ---
const INITIAL_REMOTE_GPS_POSITION = { lat: 30.6578, lng: 104.0658 }; // 遥控器内部GPS起始点
const GPS_MOVE_STEP_MULTIPLIER = 0.001; // 摇杆移动对GPS步长的乘数因子 (灵敏度)
const MOVE_INTERVAL_DELAY = 150; // 摇杆激活时发送指令的间隔 (毫秒)

function App() {
  const [mqttClient, setMqttClient] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('未连接');
  const [lastSentGps, setLastSentGps] = useState(null);
  const [commandTopic, setCommandTopic] = useState(DEFAULT_COMMAND_TOPIC);
  const [inputTopic, setInputTopic] = useState(DEFAULT_COMMAND_TOPIC);
  const [currentRemoteGps, setCurrentRemoteGps] = useState(INITIAL_REMOTE_GPS_POSITION);

  const commandQueueRef = useRef([]); // 指令发送队列
  const isPublishingRef = useRef(false); // 发布状态锁
  const joystickMoveIntervalRef = useRef(null); // 摇杆移动的定时器ID
  const currentJoystickDeltaRef = useRef({ x: 0, y: 0 }); // 当前摇杆的x, y偏移量 (标准化后)

  // 初始化 MQTT 连接
  useEffect(() => {
    console.log('尝试连接到 MQTT Broker...');
    setConnectionStatus('连接中...');
    const client = mqtt.connect(MQTT_BROKER_URL, {
      clientId: `mqtt-joystick-remote-${Math.random().toString(16).substr(2, 8)}`,
      connectTimeout: 5000,
      reconnectPeriod: 1000,
    });

    client.on('connect', () => {
      console.log('MQTT 连接成功!');
      setConnectionStatus('已连接');
      setMqttClient(client);
    });
    client.on('error', (err) => {
      console.error('MQTT 连接错误:', err);
      setConnectionStatus(`连接错误`);
    });
    client.on('reconnect', () => {
      console.log('MQTT 正在重新连接...');
      setConnectionStatus('重新连接中...');
    });
    client.on('close', () => {
      console.log('MQTT 连接已断开');
      setConnectionStatus('已断开');
    });
    client.on('offline', () => {
      console.log('MQTT 客户端离线');
      setConnectionStatus('离线');
    });

    // 组件卸载时断开连接并清除定时器
    return () => {
      if (client) {
        client.end(true);
        console.log('MQTT 连接已断开 (遥控器)');
      }
      if (joystickMoveIntervalRef.current) {
        clearInterval(joystickMoveIntervalRef.current);
      }
    };
  }, []);

  // 处理指令发送队列
  const processCommandQueue = () => {
    if (isPublishingRef.current || commandQueueRef.current.length === 0 || !mqttClient || !mqttClient.connected) {
      return;
    }
    isPublishingRef.current = true;
    const gpsPayload = commandQueueRef.current.shift();
    mqttClient.publish(commandTopic, JSON.stringify(gpsPayload), { qos: 0, retain: false }, (error) => {
      if (error) {
        console.error(`发布GPS数据到主题 ${commandTopic} 失败:`, error);
        setLastSentGps({ ...gpsPayload, topic: commandTopic, status: '发送失败' });
      } else {
        console.log(`GPS数据已发布到主题 ${commandTopic}: ${JSON.stringify(gpsPayload)}`);
        setLastSentGps({ ...gpsPayload, topic: commandTopic, status: '发送成功' });
      }
      isPublishingRef.current = false;
      if (commandQueueRef.current.length > 0) {
        setTimeout(processCommandQueue, 50); // 给网络一点喘息时间
      }
    });
  };

  // 根据摇杆的 delta 值计算并发送GPS坐标
  const sendGpsUpdateFromJoystick = () => {
    if (!commandTopic.trim()) {
      console.warn('GPS数据主题为空，无法发送。');
      return;
    }
    // 只有当摇杆实际移动时才更新GPS并发送
    if (currentJoystickDeltaRef.current.x === 0 && currentJoystickDeltaRef.current.y === 0) {
      return;
    }

    setCurrentRemoteGps(prevGps => {
      let { lat, lng } = prevGps;
      // currentJoystickDeltaRef.current.y 对应纬度变化 (摇杆向上为正，对应GPS纬度增加)
      // currentJoystickDeltaRef.current.x 对应经度变化 (摇杆向右为正，对应GPS经度增加)
      lat += currentJoystickDeltaRef.current.y * GPS_MOVE_STEP_MULTIPLIER;
      lng += currentJoystickDeltaRef.current.x * GPS_MOVE_STEP_MULTIPLIER;

      // 限制经纬度范围
      lat = Math.max(-90, Math.min(90, lat));
      lng = Math.max(-180, Math.min(180, lng));
      
      const newPosition = { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
      const gpsPayload = { ...newPosition, timestamp: Date.now() };

      commandQueueRef.current.push(gpsPayload);
      processCommandQueue();
      return newPosition; // 返回新的GPS位置以更新遥控器内部状态
    });
  };

  // 摇杆移动时的回调函数
  const handleJoystickChange = (delta) => { // delta = { x: normalizedX, y: normalizedY }
    currentJoystickDeltaRef.current = delta; // 更新当前摇杆偏移量

    // 如果MQTT未连接，则不启动定时器
    if (!mqttClient || !mqttClient.connected) return;

    if (delta.x !== 0 || delta.y !== 0) { // 如果摇杆不在中心
      if (!joystickMoveIntervalRef.current) { // 如果定时器未启动，则启动它
        sendGpsUpdateFromJoystick(); // 立即发送一次更新
        joystickMoveIntervalRef.current = setInterval(sendGpsUpdateFromJoystick, MOVE_INTERVAL_DELAY);
      }
    } else { // 如果摇杆回到中心 (理论上 onStop 会处理，但这里作为双重保险)
      if (joystickMoveIntervalRef.current) {
        clearInterval(joystickMoveIntervalRef.current);
        joystickMoveIntervalRef.current = null;
      }
    }
  };

  // 摇杆停止（归位）时的回调函数
  const handleJoystickStop = () => {
    if (joystickMoveIntervalRef.current) {
      clearInterval(joystickMoveIntervalRef.current);
      joystickMoveIntervalRef.current = null;
    }
    currentJoystickDeltaRef.current = { x: 0, y: 0 }; // 重置摇杆偏移量
    console.log('摇杆已停止，停止发送GPS数据。');
    setLastSentGps({ action: "JOYSTICK_STOP", topic: commandTopic, status: "已执行 (停止发送)" });
  };
  
  // “紧急停止”按钮的事件处理器
  const handleEmergencyStop = () => {
    handleJoystickStop(); // 调用摇杆的停止逻辑，清除定时器
    // 此处可以额外发送一个特定的停止指令到MQTT，如果地图端需要明确的停止信号
    // 例如: commandQueueRef.current.push({ type: "EMERGENCY_STOP", timestamp: Date.now() }); processCommandQueue();
    console.log('紧急停止按钮按下。');
    setLastSentGps({ action: "EMERGENCY_STOP", topic: commandTopic, status: "已执行" });
  };

  // 处理主题输入框变化的函数
  const handleTopicInputChange = (event) => {
    setInputTopic(event.target.value);
  };

  // 应用新的主题
  const handleSetTopic = () => {
    if (inputTopic.trim()) {
      setCommandTopic(inputTopic.trim());
      console.log(`指令主题已更新为: ${inputTopic.trim()}`);
      alert(`指令主题已更新为: ${inputTopic.trim()}`);
    } else {
      alert('主题不能为空!');
    }
  };

  // 获取连接状态对应的CSS类名
  const getStatusClass = () => {
    if (connectionStatus === '已连接') return 'status-connected';
    if (connectionStatus === '连接中...' || connectionStatus === '重新连接中...') return 'status-connecting';
    return 'status-disconnected';
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>MQTT GPS 遥控器</h1>
        <p>使用模拟摇杆控制</p>
      </header>

      <div className="status-display">
        <div className={`status-text ${getStatusClass()}`}>
          {connectionStatus === '已连接' ? <Wifi size={18} className="icon" /> : <WifiOff size={18} className="icon" />}
          <span>{connectionStatus}</span>
        </div>
        {mqttClient && mqttClient.connected && lastSentGps && (
          <p className="last-command-text">
            {lastSentGps.action && lastSentGps.action.includes("STOP") ? 
             `指令 (${lastSentGps.topic}): ${lastSentGps.action} - ${lastSentGps.status}` :
             `上一GPS (${lastSentGps.topic}): Lat ${lastSentGps.lat?.toFixed(4)}, Lng ${lastSentGps.lng?.toFixed(4)} - ${lastSentGps.status}`
            }
          </p>
        )}
      </div>

      <div className="topic-config-section">
        <label htmlFor="topic-input" className="topic-label">GPS数据主题:</label>
        <input
          type="text"
          id="topic-input"
          value={inputTopic}
          onChange={handleTopicInputChange}
          placeholder="例如: user/gps/realtime_track"
          className="topic-input"
          disabled={!mqttClient || !mqttClient.connected}
        />
        <button
          onClick={handleSetTopic}
          className="topic-set-button"
          disabled={!mqttClient || !mqttClient.connected || !inputTopic.trim()}
        >
          <Settings size={16} style={{ marginRight: '4px' }}/> 设置
        </button>
      </div>
      
      <div className="current-gps-display">
        <MapPin size={16} className="icon" />
        遥控器模拟位置: Lat {currentRemoteGps.lat.toFixed(4)}, Lng {currentRemoteGps.lng.toFixed(4)}
      </div>

      {/* 摇杆控制区域 */}
      <div className="joystick-area">
        <Joystick
          size={180} // 摇杆底座大小 (px)
          stickSize={70} // 摇杆本身大小 (px)
          onChange={handleJoystickChange} // 摇杆移动时触发
          onStop={handleJoystickStop}     // 摇杆释放并归位时触发
        />
      </div>
      
      {/* 紧急停止按钮 */}
      <button 
        className="emergency-stop-button control-button stop-button" // 复用之前的按钮样式
        onClick={handleEmergencyStop}
        disabled={!mqttClient || !mqttClient.connected}
        title="紧急停止所有移动"
      >
        <Power size={24} /> 紧急停止
      </button>

      <footer className="footer">
        <p>Broker: {MQTT_BROKER_URL.split('//')[1].split(':')[0]}</p>
        <p>当前GPS数据主题: {commandTopic}</p>
      </footer>
    </div>
  );
}

export default App;
