import React from 'react';
import { useParams } from 'react-router-dom';

const Canvas = () => {
  const { code } = useParams();

  return (
    <div>{code}</div>
  );
};

export default Canvas;
