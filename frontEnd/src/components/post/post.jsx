import React, { useContext, useEffect, useState , useRef } from 'react'
import axios from 'axios'
import './post.css'
//import { ChatBubbleOutline, FavoriteOutlined, LinkRounded, MoreVert } from '@mui/icons-material'
import { ChatBubbleOutline, FavoriteOutlined, MoreVert } from '@mui/icons-material'
import { format } from 'timeago.js';
import { Link } from 'react-router-dom';
import { AuthContext } from '../../state/AuthContext';

export default function Post({ post }) {
    const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;
    const [likes, setLikes] = React.useState(post.likes.length);
    const [isLiked, setIsLiked] = React.useState(false);
    const {user: currentUser} = useContext(AuthContext);
    const [user, setUser] = useState({});
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);
    
    const handleLike = async () => {
        try {
            //いいねのAPI
            await axios.put(`/posts/${post._id}/like`, {userId: currentUser._id})
            
        } catch (err) {
            console.log(err);
        }
        setLikes(isLiked ? likes - 1 : likes + 1);
        setIsLiked(!isLiked);
    }

    const handledelete = async () => {
        try {
            //投稿の削除
            await axios.delete('/posts/' + post._id, {data: {userId: currentUser._id}});
            window.location.reload();
        } catch (err) {
            console.log(err);
        }
    }
    
    const toggleMenu = (e) => {
        e.stopPropagation();
        setShowMenu(prev => !prev);
    }
    
    useEffect(() => {
        const handleClickOutSide = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowMenu(false);
            }
        };
        document.addEventListener("click", handleClickOutSide);
        return ()=> document.removeEventListener("click", handleClickOutSide);
    },[]);
    
    
    useEffect(() => {
        const fetchUser = async () => {
          const response = await axios.get(`/users?userId=${post.userId}`);
          //console.log(response.data);
          setUser(response.data);
        }
        fetchUser();
    }, [post.userId]);

  return (
    <div className='post'>
        <div className="postWrapper">
            <div className="postTop">
                <div className="postTopLeft">
                    <Link to={`/profile/${user.username}`}>
                        <img src={
                            user.profilePicture?.startsWith("http") 
                            ? user.profilePicture 
                            : PUBLIC_FOLDER + "person/noAvatar.png"
                        } 
                            alt="" 
                            className="postProfileImg" 
                        />
                    </Link>
                    <span className='postUserName'>
                        {user.username}
                    </span>
                    <span className="postDate">
                        {format(post.createdAt)}
                    </span>
                </div> 
                <div className="userMoreWrapper" ref={menuRef}>
                    <div className='postMenuButton' onClick={toggleMenu} role='button' tabIndex={0} onKeyDown={(e) =>{ if(e.key === "Enter" || e.key === " ") toggleMenu(e);}}>
                        <MoreVert className='UsersMore'/>
                    </div>
                    {showMenu && (
                        <div className="userMenu" onClick={(e)=>e.stopPropagation()}>
                            {post.userId === currentUser._id && (
                                <button className='logoutBtn' onClick={handledelete}>Delete Post</button>
                            )}{post.userId !== currentUser._id && (
                                <button className='logoutBtn' >You can't delete this post</button>
                            )}
                        </div>
                    )}
                </div>    
            </div>
            <div className="postCenter">
                <span className="postText">
                    {post.desc}
                </span>
                <img src={`${PUBLIC_FOLDER}${post.img}`} alt="" className="postImg" />
            </div>
            <div className="postBottom">
                <div className="postBottomLeft">
                    <FavoriteOutlined htmlColor='red' className='LikeIcon' sx={{ fontSize: '20px' }} onClick={() => handleLike()} />
                    <span className="postLikeCounter">
                        {likes}
                    </span>
                </div>
                <div className="postBottomRight">
                    <span className="postCommentText">
                        <ChatBubbleOutline className='postCommentText' sx={{ fontSize: '20px' }} />
                        {post.comment}
                    </span>
                </div>
            </div>
        </div>
    </div>
  )
}
