// src/Joystick.jsx
import React, { useState, useRef, useEffect } from 'react';
import './Joystick.css'; // 我们将为摇杆创建单独的CSS文件

const Joystick = ({ size = 150, stickSize = 70, onChange, onStop }) => {
  const baseRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stickPosition, setStickPosition] = useState({ x: 0, y: 0 }); // 相对于中心的偏移

  const baseRadius = size / 2;
  const stickRadius = stickSize / 2;
  const maxDisplacement = baseRadius - stickRadius; // 摇杆中心能移动的最大距离

  const handleInteractionStart = (e) => {
    e.preventDefault(); // 阻止默认事件，如拖动图片或页面滚动
    setIsDragging(true);
  };

  const handleInteractionMove = (e) => {
    if (!isDragging || !baseRef.current) return;
    e.preventDefault();

    let clientX, clientY;
    if (e.touches) { // 触摸事件
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else { // 鼠标事件
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const baseRect = baseRef.current.getBoundingClientRect();
    const baseX = baseRect.left + baseRadius; // 底座中心X坐标
    const baseY = baseRect.top + baseRadius;  // 底座中心Y坐标

    let dx = clientX - baseX;
    let dy = clientY - baseY;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxDisplacement) {
      // 如果超出范围，则将摇杆限制在边缘
      dx = (dx / distance) * maxDisplacement;
      dy = (dy / distance) * maxDisplacement;
    }

    setStickPosition({ x: dx, y: dy });
    if (onChange) {
      // 将位移标准化到 -1 到 1 之间
      const normalizedX = dx / maxDisplacement;
      const normalizedY = dy / maxDisplacement;
      onChange({ x: normalizedX, y: -normalizedY }); // 屏幕Y轴向下为正，我们希望向上（前进）为正Y
    }
  };

  const handleInteractionEnd = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    setIsDragging(false);
    setStickPosition({ x: 0, y: 0 }); // 摇杆归位
    if (onStop) {
      onStop();
    }
  };

  useEffect(() => {
    const moveHandler = (e) => handleInteractionMove(e);
    const endHandler = (e) => handleInteractionEnd(e);

    if (isDragging) {
      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', endHandler);
      window.addEventListener('touchmove', moveHandler, { passive: false });
      window.addEventListener('touchend', endHandler);
    } else {
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', endHandler);
      window.removeEventListener('touchmove', moveHandler);
      window.removeEventListener('touchend', endHandler);
    }

    return () => { // 清理函数
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', endHandler);
      window.removeEventListener('touchmove', moveHandler);
      window.removeEventListener('touchend', endHandler);
    };
  }, [isDragging, handleInteractionMove, handleInteractionEnd]); // 确保依赖项正确

  return (
    <div
      ref={baseRef}
      className="joystick-base"
      style={{ width: `${size}px`, height: `${size}px` }}
      // 如果希望在底座上点击也开始拖动，可以取消注释下面两行
      // onMouseDown={handleInteractionStart} 
      // onTouchStart={handleInteractionStart}
    >
      <div
        className="joystick-stick"
        style={{
          width: `${stickSize}px`,
          height: `${stickSize}px`,
          transform: `translate(${stickPosition.x}px, ${stickPosition.y}px)`,
        }}
        onMouseDown={handleInteractionStart} // 只在摇杆本身上开始拖动
        onTouchStart={handleInteractionStart} // 同上
      >
      </div>
    </div>
  );
};

export default Joystick;