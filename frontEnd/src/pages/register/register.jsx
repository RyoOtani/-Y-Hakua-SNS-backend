import React, { useRef } from 'react'
import "./register.css"
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Register() {
  const username = useRef();
  const email = useRef();
  const password = useRef();
  const confirmpassword = useRef();

  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    //パスワードと確認用のパスワードが一致しているか確認
    if(password.current.value !== confirmpassword.current.value) {
      confirmpassword.current.setCustomValidity("passwords don't match!")
    }else {
      try {
        //登録処理
        const user = {
          username: username.current.value,
          email:email.current.value,
          password:password.current.value,
        };
        await axios.post("/auth/register" , user);
        navigate("/login");
      } catch (err) {
        console.log(err);
      }
    }
  };
  
  return (
    <div className='login'>
      <div className="loginWrapper">
        <div className="loginLeft">
          <h3 className="loginLogo">Y</h3>
          <span className="loginDesc">
            学校専用のSNSで友達と繋がろう！
          </span>
        </div>
        <div className="loginRight">
          <form className="loginBox" onSubmit={(e) => handleSubmit(e)}>
            <h2 className="loginMsg">新規登録はこちらから</h2>
            <input 
            type="text"
            placeholder='Username' 
            className="loginInput" 
            required
            ref = {username}
            />
            <input 
            type="email"
            placeholder='Email' 
            className="loginInput" 
            required 
            ref = { email}
            />
            <input 
            placeholder='Password' 
            className="loginInput" 
            type="password"
            required
            ref = {password}
            />
            <input 
            placeholder='Confirm Password' 
            className="loginInput" 
            type="password"
            required
            ref = {confirmpassword}
            />
            <button className="loginButton" type="submit">Sign up</button>
            <button className="loginRegisterButton">Login</button>
          </form>
        </div>
      </div>
    </div>
  )
}
