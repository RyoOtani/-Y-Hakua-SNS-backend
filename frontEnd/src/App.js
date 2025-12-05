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
import axios from 'axios';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthContext } from './state/AuthContext';



function App() {
  const { user } = useContext(AuthContext);
  useEffect(() => {
    // localStorageからトークンを取得して設定
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  }, []);
  
  return (
    <Router>
      <Routes>
        {/* <Route path="/" element={user ? <Home /> : <Navigate to = "/login" />} />
        <Route path="/" element={
            <PrivateRoute>
              <Home />
            </PrivateRoute>
          }
        />
        
        <Route path="/login" element={user ? <Navigate to={"/"} /> : <Login />} />
        <Route path="/auth/success" element={<AuthCallback />} />
        {/* <Route path="/register" element={user ? <Navigate to={"/"} /> : <Register />} /> */}
        {/* <Route path="/profile/:username" element={user ? <Profile /> : <Navigate to={"/login"} />} /> */}
        {/* 検索結果ページ */}
        {/* <Route path="/search" element={user ? <SearchResults /> : <Navigate to={"/login"} />} />  */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/success" element={<AuthCallback />} />
        <Route path="/"
          element={
            <PrivateRoute>
              <Home />
            </PrivateRoute>
          }
        />
      </Routes>  
    </Router>
  );
}



export default App;
