// publisher.js (ES Module Syntax)
import mqtt from 'mqtt'; // Use import instead of require

const MQTT_BROKER_URL = 'mqtt://broker.emqx.io:1883'; // Node.js 通常使用 TCP 端口
const GPS_DATA_TOPIC = 'user/gps/realtime_track';

console.log(`尝试连接到 MQTT Broker: ${MQTT_BROKER_URL}`);
const client = mqtt.connect(MQTT_BROKER_URL);

client.on('connect', () => {
    console.log('成功连接到 MQTT Broker (作为发布者)!');

    // 模拟发送一系列 GPS 数据点
    const track = [
        { lat: 30.6578, lng: 104.0658, timestamp: Date.now() },
        { lat: 30.6588, lng: 104.0668, timestamp: Date.now() + 2000 },
        { lat: 30.6598, lng: 104.0678, timestamp: Date.now() + 4000 },
        { lat: 30.6608, lng: 104.0688, timestamp: Date.now() + 6000 },
        { lat: 30.6618, lng: 104.0698, timestamp: Date.now() + 8000 },
    ];

    let index = 0;
    const intervalId = setInterval(() => {
        if (index < track.length) {
            const payload = JSON.stringify(track[index]);
            client.publish(GPS_DATA_TOPIC, payload, { qos: 0, retain: false }, (err) => {
                if (err) {
                    console.error('发布失败:', err);
                } else {
                    console.log(`消息已发布到主题 ${GPS_DATA_TOPIC}: ${payload}`);
                }
            });
            index++;
        } else {
            clearInterval(intervalId); // 发送完毕，停止定时器
            console.log('所有模拟数据点已发送完毕。');
            client.end(true, () => { // true 表示强制关闭并等待回调
                console.log('发布者客户端已断开连接。');
            }); // 关闭连接
        }
    }, 2000); // 每2秒发送一个点
});

client.on('error', (err) => {
    console.error('MQTT 连接错误 (发布者):', err);
    // 可以在这里尝试优雅地关闭客户端，如果它还没有关闭的话
    if (client && !client.ended) {
        client.end(true);
    }
});

client.on('close', () => {
    console.log('发布者客户端连接已关闭。');
});

client.on('offline', () => {
    console.log('发布者客户端已离线。');
});
