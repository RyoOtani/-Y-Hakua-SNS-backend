import React, { useEffect, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import axios from 'axios';
import { AuthContext } from '../state/AuthContext';
import { jwtDecode } from 'jwt-decode';

const AuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { dispatch } = useContext(AuthContext);

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (token) {
      // トークンをlocalStorageに保存
      localStorage.setItem('token', token);
      
      // APIのデフォルトヘッダーにトークンを設定
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // JWTをデコードしてユーザー情報を取得
      try {
        const decodedUser = jwtDecode(token);
        // AuthContextにユーザー情報をディスパッチ
        dispatch({ type: "LOGIN_SUCCESS", payload: decodedUser });
      } catch (error) {
        console.error("Failed to decode JWT or dispatch LOGIN_SUCCESS:", error);
        // エラーの場合はログインページへ
        navigate('/login');
        return;
      }
      
      // ホームページへリダイレクト
      navigate('/');
    } else {
      // エラーの場合はログインページへ
      navigate('/login');
    }
  }, [searchParams, navigate, dispatch]);

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