// import Home from './pages/home/Home';
// import Login from './pages/login/login';
// import Register from './pages/register/register';
// import Profile from './pages/profile/profile';
// import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
// import { useContext } from 'react';
// import { AuthContext } from './state/AuthContext';


// function App() {
//   const { user } = useContext(AuthContext);
  
//   return (
//     <Router>
//       <Routes>
//         <Route path="/" element={user ? <Home /> : <Navigate to = "/login" />} />
//         <Route path="/login" element={user ? <Navigate to={"/"} /> : <Login />} />
//         <Route path="/register" element={user ? <Navigate to={"/"} /> : <Register />} />
//         <Route path="/profile/:username" element={user ? <Profile /> : <Navigate to={"/login"} />} />
//       </Routes>
//     </Router>
//   );
// }

import Home from './pages/home/Home';
import Login from './pages/login/login';
import Register from './pages/register/register';
import Profile from './pages/profile/profile';
import SearchResults from './pages/search_result/search_result';
import AuthCallback from './pages/AuthCallback';
import PrivateRoute from './components/PrivateRoute';
import { useEffect } from 'react';

import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthContext } from './state/AuthContext';
import axios from 'axios';


function App() {
  const { user, dispatch } = useContext(AuthContext);
  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        try {
          // サーバーに現在のユーザー情報を問い合わせるエンドポイントを想定
          const response = await axios.get('/users/me'); 
          dispatch({ type: 'LOGIN_SUCCESS', payload: response.data });
        } catch (err) {
          console.error("トークンによるユーザー情報の取得に失敗しました:", err);
          // トークンが無効な場合などは、エラーとして扱う
          dispatch({ type: 'LOGIN_FAILURE', payload: err });
          localStorage.removeItem('token'); // 無効なトークンを削除
        }
      }
    };
    fetchUser();
    // dispatchはReactのstate setterなので通常は依存配列に含める必要はありませんが、
    // ESLintの警告を避けるために含めています。
  }, [dispatch]);
  
  return (
    <Router>
      <Routes>
        {/* 保護されたルート */}
        <Route path="/" element={user ? <Home /> : <Navigate to="/login" />} />
        <Route path="/profile/:username" element={user ? <Profile /> : <Navigate to={"/login"} />} />
        <Route path="/search" element={user ? <SearchResults /> : <Navigate to={"/login"} />} />

        {/* 公開ルート */}
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" /> : <Register />} />
        <Route path="/auth/success" element={<AuthCallback />} />
      </Routes>  
    </Router>
  );
}



export default App;
