// import { createContext , useReducer } from "react";
// import AuthReducer from "./AuthReducer";

// //最初のユーザ状態

// const initialState = {
//     user: null,
//     // user: {
//     //     _id: "690769349b9eb8a9779010c3",
//     //     username: "たこ",
//     //     email: "tako@mail.com",
//     //     password: "123456",
//     //     profilePicture: "/person/1.jpeg",
//     //     coverPicture: "",
//     //     followers: [],
//     //     followings: [],
//     //     isAdmin: false,
//     // },
//     isFetching: false,
//     error: false,
// };

// //状態をグローバル管理

// export const AuthContext = createContext(initialState);

// export const AuthContextProvider = ({children}) => {
//     const [state, dispatch] = useReducer(AuthReducer, initialState);
//     return <AuthContext.Provider value={{
//         user:state.user,
//         isFetching:state.isFetching,
//         error:state.error,
//         dispatch,
//     }}>
//         {children}
//     </AuthContext.Provider>
// };

//AI exciting code=>

import { createContext, useReducer, useEffect } from "react";
import AuthReducer from "./AuthReducer";

// 🧠 localStorage からユーザー情報を読み取る
const storedUser = JSON.parse(localStorage.getItem("user"));

const initialState = {
  user: storedUser || null, // ← もし保存されていたらそれを使う！
  isFetching: false,
  error: false,
};

export const AuthContext = createContext(initialState);

export const AuthContextProvider = ({ children }) => {
  const [state, dispatch] = useReducer(AuthReducer, initialState);

  // 💾 user の変化を監視して localStorage に保存する
  useEffect(() => {
    localStorage.setItem("user", JSON.stringify(state.user));
    if (state.user) {
      document.body.style.backgroundColor = state.user.backgroundColor || "#ffffff";
      document.body.style.fontFamily = state.user.font || "Arial";
    } else {
      // Reset to default if no user is logged in
      document.body.style.backgroundColor = "#ffffff";
      document.body.style.fontFamily = "Arial";
    }
  }, [state.user]);

  return (
    <AuthContext.Provider
      value={{
        user: state.user,
        isFetching: state.isFetching,
        error: state.error,
        dispatch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
