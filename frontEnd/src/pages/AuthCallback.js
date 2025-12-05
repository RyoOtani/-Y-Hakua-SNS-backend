import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import axios from 'axios';

const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (token) {
      // トークンをlocalStorageに保存
      localStorage.setItem('token', token);
      
      // APIのデフォルトヘッダーにトークンを設定
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // ホームページへリダイレクト
      navigate('/');
    } else {
      // エラーの場合はログインページへ
      navigate('/login');
    }
  }, [searchParams, navigate]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      <CircularProgress />
    </Box>
  );
};

export default AuthCallback;