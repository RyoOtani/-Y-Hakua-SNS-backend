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
import Setting from './pages/setting/setting';
import Messenger from './pages/messenger/Messenger'; // Import Messenger component
import Notification from './pages/notification/notification';
import PrivacyPolicy from './pages/privacyPolicy/PrivacyPolicy';
import Ranking from './pages/ranking/ranking';
import { useEffect } from 'react';


import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthContext } from './state/AuthContext';
import axios from 'axios';


function App() {
  const { user, dispatch } = useContext(AuthContext);

  const needsPrivacyAgreement = user && !user.hasAgreedToPrivacyPolicy;

  const themeColors = {
    light: "#ffffff",
    dark: "#15202b",
  };

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("token");
      if (token) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
        try {
          const response = await axios.get("/api/users/me");
          dispatch({ type: "LOGIN_SUCCESS", payload: response.data });
        } catch (err) {
          console.error(
            "トークンによるユーザー情報の取得に失敗しました:",
            err
          );
          dispatch({ type: "LOGIN_FAILURE", payload: err });
          localStorage.removeItem("token");
        }
      }
    };
    fetchUser();
  }, [dispatch]);

  // Effect to apply theme settings globally
  useEffect(() => {
    if (user) {
      const theme =
        (user.backgroundColor || "").toLowerCase() === themeColors.dark.toLowerCase() ? "dark" : "light";
      document.body.style.backgroundColor = user.backgroundColor || themeColors.light;
      document.body.style.fontFamily = user.font || "Arial";

      if (theme === "dark") {
        document.body.classList.add("dark-theme");
      } else {
        document.body.classList.remove("dark-theme");
      }
    }
  }, [user]); // Rerun when user object changes

  return (
    <Router>
      <Routes>
        {/* 保護されたルート */}
        <Route
          path="/"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <Home />
              )
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/profile/:username"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <Profile />
              )
            ) : (
              <Navigate to={"/login"} />
            )
          }
        />
        <Route
          path="/search"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <SearchResults />
              )
            ) : (
              <Navigate to={"/login"} />
            )
          }
        />
        <Route
          path="/setting"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <Setting />
              )
            ) : (
              <Navigate to={"/login"} />
            )
          }
        />
        <Route
          path="/messenger"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <Messenger />
              )
            ) : (
              <Navigate to={"/login"} />
            )
          }
        />
        <Route
          path="/notifications"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <Notification />
              )
            ) : (
              <Navigate to={"/login"} />
            )
          }
        />
        <Route
          path="/privacy-policy"
          element={user ? <PrivacyPolicy /> : <Navigate to="/login" />}
        />
        <Route
          path="/ranking"
          element={
            user ? (
              needsPrivacyAgreement ? (
                <Navigate to="/privacy-policy" />
              ) : (
                <Ranking />
              )
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* 公開ルート */}
        <Route
          path="/login"
          element={user ? <Navigate to="/" /> : <Login />}
        />
        <Route
          path="/register"
          element={user ? <Navigate to="/" /> : <Register />}
        />
        <Route path="/auth/success" element={<AuthCallback />} />
      </Routes>
    </Router>
  );
}



export default App;
