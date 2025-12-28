import React, { useContext, useEffect, useState , useRef } from 'react'
import axios from 'axios'
import './post.css'
//import { ChatBubbleOutline, FavoriteOutlined, LinkRounded, MoreVert } from '@mui/icons-material'
import { ChatBubbleOutline, FavoriteOutlined, MoreVert } from '@mui/icons-material'
import { format } from 'timeago.js';
import { Link } from 'react-router-dom';
import { AuthContext } from '../../state/AuthContext';
import Comment from '../comment/Comment'; // Commentコンポーネントをインポート

export default function Post({ post }) {
    const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;
    const [likes, setLikes] = React.useState(post.likes.length);
    const [isLiked, setIsLiked] = React.useState(false);
    const {user: currentUser} = useContext(AuthContext);
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);
    const [showComments, setShowComments] = useState(false); // コメント表示用のstate
    const [commentText, setCommentText] = useState(""); // コメント入力用
    const [commentCount, setCommentCount] = useState(post.comment); // コメント数用
    const [comments, setComments] = useState([]); // コメントリスト用

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

    const handleCommentSubmit = async () => {
        if (commentText.trim() === "") return;
    
        try {
            const res = await axios.post(`/posts/${post._id}/comment`, {
                userId: currentUser._id,
                desc: commentText,
            });
            // サーバーからのレスポンスに currentUser の情報を付加して擬似的なpopulateを行う
            const newComment = {
                ...res.data,
                userId: {
                    _id: currentUser._id,
                    username: currentUser.username,
                    profilePicture: currentUser.profilePicture,
                },
            };
            setComments([newComment, ...comments]); // 新しいコメントをリストの先頭に追加
            setCommentText("");
            setCommentCount(commentCount + 1);
        } catch (err) {
            console.error("コメントの投稿に失敗しました", err);
        }
    };
    
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
        const fetchComments = async () => {
            if (showComments) {
                try {
                    const res = await axios.get(`/posts/${post._id}/comments`);
                    setComments(res.data); // バックエンドでソート済み
                } catch (err) {
                    console.error("コメントの取得に失敗しました", err);
                }
            }
        };
        fetchComments();
    }, [showComments, post._id]);
    
    
  return (
    <div className='post'>
        <div className="postWrapper">
            <div className="postTop">
                <div className="postTopLeft">
                    <Link to={`/profile/${post.userId?.username}`}>
                        <img src={
                            post.userId?.profilePicture?.startsWith("http") 
                            ? post.userId.profilePicture 
                            : PUBLIC_FOLDER + "person/noAvatar.png"
                        } 
                            alt="" 
                            className="postProfileImg" 
                        />
                    </Link>
                    <span className='postUserName'>
                        {post.userId?.username}
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
                            {post.userId._id === currentUser._id && (
                                <button className='logoutBtn' onClick={handledelete}>Delete Post</button>
                            )}{post.userId._id !== currentUser._id && (
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
                <div className="postBottomRight" onClick={() => setShowComments(!showComments)} style={{cursor: 'pointer'}}>
                    <span className="postCommentText">
                        <ChatBubbleOutline className='postCommentText' sx={{ fontSize: '20px' }} />
                        {commentCount}
                    </span>
                </div>
            </div>
            {showComments && (
                <div className="commentSection">
                    {/* コメント入力フォーム */}
                    <div className="commentInputWrapper">
                        <input 
                            placeholder="コメントを追加..." 
                            className="commentInput" 
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                        />
                        <button className="commentSubmitButton" onClick={handleCommentSubmit}>送信</button>
                    </div>
                    {/* コメント一覧 */}
                    <div className="commentList">
                        {comments.map((comment) => (
                            <Comment key={comment._id} comment={comment} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    </div>
  )
}
