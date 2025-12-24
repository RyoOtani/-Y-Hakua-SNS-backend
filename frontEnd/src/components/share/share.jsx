// import React, { useContext, useRef, useState } from 'react'
import './share.css'
import { Analytics, EmojiEmotions, GifBox, Image } from '@mui/icons-material'
import { AuthContext } from '../../state/AuthContext';
import axios from 'axios';
import React, { useContext, useRef } from 'react'

export default function Share() {
  const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;
  const {user} = useContext(AuthContext);
  const desc = useRef();
  //const [file, setFile] = useState(null);

  const handleSubmit = async (e) => {
    //投稿のAPI
    e.preventDefault();
    const newPost = {
        userId: user._id,
        desc: desc.current.value,
    }
    try {
        await axios.post('/posts', newPost);
        window.location.reload();
    }catch(err) {
        console.log(err);
    }
    console.log();
  }
  
  return (
    <>
    {user && (
    <div className='share'>
        <div className="shareWrapper">
            <div className="shareTop">
                <img 
                   src={
                            user.profilePicture?.startsWith("http") 
                            ? user.profilePicture 
                            : PUBLIC_FOLDER + "person/noAvatar.png"
                        }
                    alt="" 
                    className="shareProfileImg" 
                />
                <input
                    type="text"
                    placeholder="今日を振り返ろう" 
                    className="shareInput"
                    ref={desc} 
                />
            </div>
            <hr className="shareHr" />
            <div className="shareButton">
                <form className="shareOptions" onSubmit={(e) => handleSubmit(e)}>
                    <div className="shareOptionDetail">
                        <label className="shareOption" 
                        htmlFor="file" 
                        >
                            <Image htmlColor='royalblue'/>
                            <span className="onMouseIcon">
                                Media
                            </span>
                            <input type="file" 
                            id="file" 
                            accept=".png, .jpeg, .jpg" 
                            style={{ display: "none" }} 
                            //onChange={(e) => setFile(e.target.files[0])}
                            name="file"
                            />
                        </label>
                        <div className="shareOption">
                            <GifBox className='shareIcon' htmlColor='royalblue'/>
                            <span className="onMouseIcon">
                                GIF
                            </span>
                        </div>
                        <div className="shareOption">
                            <EmojiEmotions className='shareIcon' htmlColor='royalblue'/>
                            <span className="onMouseIcon">
                                Emoji
                            </span>
                        </div>
                        <div className="shareOption">
                            <Analytics className='shareIcon' htmlColor='royalblue'/>
                            <span className="onMouseIcon">
                                Poll
                            </span>
                        </div>
                    </div>
                    <button className="shareButton" type="submit">シェアする</button>
                </form>
            </div>
        </div>
    </div>
    )}
    </>
  )
}
