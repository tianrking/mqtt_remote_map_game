import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, StopCircle, Wifi, WifiOff, Settings, MapPin } from 'lucide-react';
import './App.css'; // 导入我们自定义的CSS文件

// --- MQTT 配置 ---
const MQTT_BROKER_URL = 'ws://broker.emqx.io:8083/mqtt';
const DEFAULT_COMMAND_TOPIC = 'user/gps/realtime_track'; // 默认设置为地图应用监听的主题

// 遥控器内部模拟GPS的起始点 (例如，成都的某个点)
const INITIAL_REMOTE_GPS_POSITION = { lat: 30.6578, lng: 104.0658 };
const GPS_MOVE_STEP = 0.0005; // 每次移动的步长 (经纬度单位)
const MOVE_INTERVAL_DELAY = 200; // 长按时发送指令的间隔 (毫秒)

function App() {
  const [mqttClient, setMqttClient] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('未连接');
  const [lastSentGps, setLastSentGps] = useState(null); // 上一个发送的GPS数据
  const [commandTopic, setCommandTopic] = useState(DEFAULT_COMMAND_TOPIC);
  const [inputTopic, setInputTopic] = useState(DEFAULT_COMMAND_TOPIC);

  // 遥控器内部维护的当前模拟GPS位置
  const [currentRemoteGps, setCurrentRemoteGps] = useState(INITIAL_REMOTE_GPS_POSITION);

  const commandQueueRef = useRef([]);
  const isPublishingRef = useRef(false);
  const moveIntervalRef = useRef(null); // 用于存储长按移动的定时器ID
  const activeDirectionRef = useRef(null); // 用于存储当前长按的方向

  useEffect(() => {
    console.log('尝试连接到 MQTT Broker...');
    setConnectionStatus('连接中...');
    const client = mqtt.connect(MQTT_BROKER_URL, {
      clientId: `mqtt-remote-gps-sender-${Math.random().toString(16).substr(2, 8)}`,
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

    return () => {
      if (client) {
        console.log('正在断开 MQTT 连接 (遥控器)...');
        client.end(true, () => {
          console.log('MQTT 连接已成功断开 (遥控器)');
        });
      }
      // 组件卸载时确保清除定时器
      if (moveIntervalRef.current) {
        clearInterval(moveIntervalRef.current);
        moveIntervalRef.current = null;
      }
    };
  }, []);

  const processCommandQueue = () => {
    if (isPublishingRef.current || commandQueueRef.current.length === 0 || !mqttClient || !mqttClient.connected) {
      return;
    }
    isPublishingRef.current = true;
    const gpsPayload = commandQueueRef.current.shift(); // payload 现在是 GPS 对象

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
         setTimeout(processCommandQueue, 100); // 增加一点延迟，避免过于频繁
      }
    });
  };

  // 计算并发送GPS坐标的函数
  const handleMoveCommand = (direction) => {
    if (!commandTopic.trim()) {
        // 在连续发送时不使用 alert，避免中断用户操作
        console.warn('指令主题为空，无法发送移动指令。');
        return;
    }

    // 使用函数式更新来确保基于最新的 currentRemoteGps 计算
    // 这在由 setInterval 频繁调用时尤其重要
    setCurrentRemoteGps(prevGps => {
        let { lat, lng } = prevGps;

        switch (direction) {
          case 'UP':
            lat += GPS_MOVE_STEP;
            break;
          case 'DOWN':
            lat -= GPS_MOVE_STEP;
            break;
          case 'LEFT':
            lng -= GPS_MOVE_STEP;
            break;
          case 'RIGHT':
            lng += GPS_MOVE_STEP;
            break;
          default:
            console.warn('未知的移动方向:', direction);
            return prevGps; // 如果方向未知，返回旧的GPS状态
        }

        lat = Math.max(-90, Math.min(90, lat));
        lng = Math.max(-180, Math.min(180, lng));
        
        const newPosition = { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
        const gpsPayload = { ...newPosition, timestamp: Date.now() };

        commandQueueRef.current.push(gpsPayload);
        processCommandQueue();
        return newPosition; // 返回新的GPS位置以更新状态
    });
  };

  // 开始持续移动的函数
  const startContinuousMove = (direction) => {
    if (!mqttClient || !mqttClient.connected) return; // 如果MQTT未连接，则不执行任何操作
    
    // 如果已经有一个方向的定时器在运行，先清除它
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
    }
    activeDirectionRef.current = direction; // 设置当前激活的方向
    handleMoveCommand(direction); // 立即执行一次移动

    // 启动定时器，以MOVE_INTERVAL_DELAY的间隔持续发送移动指令
    moveIntervalRef.current = setInterval(() => {
      if (activeDirectionRef.current) { // 确保方向仍然是激活的
        handleMoveCommand(activeDirectionRef.current);
      } else {
        // 如果activeDirectionRef.current为null（例如被stopContinuousMove清除），则也清除定时器
        clearInterval(moveIntervalRef.current);
        moveIntervalRef.current = null;
      }
    }, MOVE_INTERVAL_DELAY);
  };

  // 停止持续移动的函数
  const stopContinuousMove = () => {
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
      moveIntervalRef.current = null;
    }
    activeDirectionRef.current = null; // 清除激活的方向
  };

  // “停止”按钮的事件处理器
  const handleStopButtonPress = () => {
    stopContinuousMove(); // 确保停止任何正在进行的持续移动
    console.log('停止指令被按下，已停止发送新的GPS移动数据。');
    setLastSentGps({ action: "STOP", topic: commandTopic, status: "已执行 (停止发送)" });
  };

  const handleTopicInputChange = (event) => {
    setInputTopic(event.target.value);
  };

  const handleSetTopic = () => {
    if (inputTopic.trim()) {
      setCommandTopic(inputTopic.trim());
      console.log(`指令主题已更新为: ${inputTopic.trim()}`);
      alert(`指令主题已更新为: ${inputTopic.trim()}`);
    } else {
      alert('主题不能为空!');
    }
  };

  // ControlButton 组件现在接收 onPress 和 onRelease 用于方向键
  const ControlButton = ({ icon: Icon, label, onPress, onRelease, onClick, type = 'direction' }) => {
    const isDisabled = !mqttClient || !mqttClient.connected;

    if (type === 'direction') { // 方向按钮使用长按逻辑
        return (
            <button
              disabled={isDisabled}
              onMouseDown={() => onPress && onPress()} // 鼠标按下
              onMouseUp={() => onRelease && onRelease()}   // 鼠标松开
              onMouseLeave={() => onRelease && onRelease()} // 鼠标移出按钮区域也视为松开
              onTouchStart={(e) => { e.preventDefault(); onPress && onPress(); }} // 触摸开始，阻止默认行为如页面滚动
              onTouchEnd={() => onRelease && onRelease()}     // 触摸结束
              className={`control-button direction-button`}
              aria-label={label}
            >
              <Icon size={28} strokeWidth={2.5} />
              <span className="sr-only">{label}</span>
            </button>
        );
    }
    // 停止按钮使用普通的 onClick
    return (
        <button
          onClick={onClick}
          disabled={isDisabled}
          className={`control-button stop-button`}
          aria-label={label}
        >
          <Icon size={28} strokeWidth={2.5} />
          <span className="sr-only">{label}</span>
        </button>
    );
  };

  const getStatusClass = () => {
    if (connectionStatus === '已连接') return 'status-connected';
    if (connectionStatus === '连接中...' || connectionStatus === '重新连接中...') return 'status-connecting';
    return 'status-disconnected';
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>MQTT GPS 遥控器</h1>
        <p>长按方向键可持续移动</p> {/* 更新描述 */}
      </header>

      <div className="status-display">
        <div className={`status-text ${getStatusClass()}`}>
          {connectionStatus === '已连接' ? (
            <Wifi size={18} className="icon" />
          ) : (
            <WifiOff size={18} className="icon" />
          )}
          <span>{connectionStatus}</span>
        </div>
        {mqttClient && mqttClient.connected && lastSentGps && (
          <p className="last-command-text">
            {lastSentGps.action === "STOP" ? 
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

      <div className="controls-grid">
        <div></div>
        {/* 方向按钮现在传递 onPress 和 onRelease 回调 */}
        <ControlButton icon={ArrowUp} label="前进" type="direction" onPress={() => startContinuousMove('UP')} onRelease={stopContinuousMove} />
        <div></div>
        <ControlButton icon={ArrowLeft} label="左转" type="direction" onPress={() => startContinuousMove('LEFT')} onRelease={stopContinuousMove} />
        {/* 停止按钮仍然使用 onClick */}
        <ControlButton icon={StopCircle} label="停止" type="stop" onClick={handleStopButtonPress} />
        <ControlButton icon={ArrowRight} label="右转" type="direction" onPress={() => startContinuousMove('RIGHT')} onRelease={stopContinuousMove} />
        <div></div>
        <ControlButton icon={ArrowDown} label="后退" type="direction" onPress={() => startContinuousMove('DOWN')} onRelease={stopContinuousMove} />
        <div></div>
      </div>

      <footer className="footer">
        <p>Broker: {MQTT_BROKER_URL.split('//')[1].split(':')[0]}</p>
        <p>当前GPS数据主题: {commandTopic}</p>
      </footer>
    </div>
  );
}

export default App;
