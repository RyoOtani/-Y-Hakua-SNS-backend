// import { Link } from "react-router-dom";
// import AuthLayout from "../../components/auth/AuthLayout";


// export default function Login() {
//   return (
//     <AuthLayout>
//       <form className="login-form">
//         <input type="text" placeholder="ユーザー名またはメールアドレス" />
//         <input type="password" placeholder="パスワード" />
//         <button type="submit">ログイン</button>
//       </form>

//       <div className="divider">
//         <div className="line"></div>
//         <span>または</span>
//         <div className="line"></div>
//       </div>

//       <p className="switch-text">
//         アカウントをお持ちでないですか？{" "}
//         <Link to="/signup" className="link">
//           登録する
//         </Link>
//       </p>
//     </AuthLayout>
//   );
// }


// import React, { useContext, useRef } from 'react'
// import "./login.css";
// import { loginCall } from '../../ActionCalls';
// import { AuthContext } from '../../state/AuthContext';

// export default function Login() {
//   const email = useRef();
//   const password = useRef();
//   const { user , isFetching , error , dispatch } = useContext(AuthContext);

//   const handleSubmit = (e) => {
//     e.preventDefault();
//     // console.log(email.current.value);
//     // console.log(password.current.value);
//     loginCall({
//       email:email.current.value,
//       password:password.current.value,
//     }, dispatch
//     );
//   };

//   const handoleGoogleLogin = () => {
//     window.location.href = "http://localhost:8800/auth/google";
//   }

//   console.log(user);

//   return (
//     <div className='login'>
//       <div className="loginWrapper">
//         <div className="loginLeft">
//           <h3 className="loginLogo">
//             Y
//           </h3>
//           <span className="loginDesc">
//             学校専用のSNSで友達と繋がろう！
//           </span>
//         </div>
//         <div className="loginRight">
//           <form className="loginBox" onSubmit={(e) => handleSubmit(e)}>
//             <h2 className="loginMsg">ログインはこちらから</h2>
//             <button onClick={handoleGoogleLogin} type="button" className="loginInput">
//               Login with Google
//             </button>
//             {/* <input 
//               type="email" 
//               placeholder='Email' 
//               className="loginInput" 
//               required
//               ref={email}
//             />
//             <input 
//               placeholder='Password' 
//               className="loginInput" 
//               type="password" 
//               minLength="6"
//               required
//               ref={password}
//             />
//             <button className="loginButton">Login</button>

//             <button className="loginRegisterButton">Register</button> */}

//           </form>          
//         </div>
//       </div>
//     </div>
//   )
// }

import React, { useContext, useRef } from 'react'
import "./login.css";
import { loginCall } from '../../ActionCalls';
import { AuthContext } from '../../state/AuthContext';
import GoogleIcon from '@mui/icons-material/Google';
import { useNavigate } from 'react-router-dom';
import { Button, Container, Typography } from '@mui/material';


export default function Login() {
  const navigate = useNavigate();

  const handleGoogleLogin = () => {
    // バックエンドのGoogle OAuth認証URLにリダイレクト
    window.location.href = `${process.env.REACT_APP_API_URL}/auth/google`;
  };

  return (
    <div className='login'>
      <div className="loginWrapper">
        <div className="loginLeft">
          <h3 className="loginLogo">
            Y
          </h3>
          <span className="loginDesc">
            学校専用のSNSで友達と繋がろう！
          </span>
        </div>
        <div className="loginRight">
          <form className="loginBox" >
            <h2 className="loginMsg">ログインはこちらから</h2>
            <Button
              variant="contained"
              fullWidth
              onClick={handleGoogleLogin}
              startIcon={<GoogleIcon />}
              sx={{
                backgroundColor: '#ffffff',
                color: '#000000',
                '&:hover': {
                  backgroundColor: '#f1f1f1',
                },
                textTransform: 'none',
                fontSize: '1rem',
                fontWeight: 600,
                padding: '12px',
                borderRadius: '30px',
              }}
            >
              Googleでログイン
            </Button>

          </form>
        </div>
      </div>
    </div>
  )
}

// import React from 'react';
// import { useNavigate } from 'react-router-dom';
// import { Box, Button, Container, Typography } from '@mui/material';
// import GoogleIcon from '@mui/icons-material/Google';

// const Login = () => {
//   const navigate = useNavigate();

//   const handleGoogleLogin = () => {
//     // バックエンドのGoogle OAuth認証URLにリダイレクト
//     window.location.href = `${process.env.REACT_APP_API_URL}/auth/google`;
//   };

//   return (
//     <Container maxWidth="sm">
//       <Box
//         sx={{
//           display: 'flex',
//           flexDirection: 'column',
//           alignItems: 'center',
//           justifyContent: 'center',
//           minHeight: '100vh',
//           gap: 3,
//         }}
//       >
//         <Typography variant="h3" component="h1" gutterBottom>
//           Real SNS
//         </Typography>
//         <Typography variant="body1" color="textSecondary">
//           ログイン
//         </Typography>

//         <Button
//           variant="contained"
//           fullWidth
//           onClick={handleGoogleLogin}
//           startIcon={<GoogleIcon />}
//           sx={{
//             backgroundColor: '#1f2937',
//             '&:hover': { backgroundColor: '#111827' },
//             textTransform: 'none',
//             fontSize: '1rem',
//             padding: '12px',
//           }}
//         >
//           Googleでログイン
//         </Button>
//       </Box>
//     </Container>
//   );
// };

// export default Login;