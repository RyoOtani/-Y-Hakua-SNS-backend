import React, { useContext, useEffect, useState, useRef } from 'react'
import axios from 'axios'
import './post.css'
//import { ChatBubbleOutline, FavoriteOutlined, LinkRounded, MoreVert } from '@mui/icons-material'
import { ChatBubbleOutline, FavoriteOutlined, MoreVert, AttachFile, Cancel } from '@mui/icons-material'
import { format } from 'timeago.js';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../state/AuthContext';
import Comment from '../comment/Comment'; // Commentコンポーネントをインポート
import imageCompression from 'browser-image-compression';

export default function Post({ post }) {
    const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";
    const [likes, setLikes] = React.useState(post.likes.length);
    const [isLiked, setIsLiked] = React.useState(false);
    const { user: currentUser } = useContext(AuthContext);
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);
    const [showComments, setShowComments] = useState(false); // コメント表示用のstate
    const [commentText, setCommentText] = useState(""); // コメント入力用
    const [commentFile, setCommentFile] = useState(null); // コメント画像用
    const [commentCount, setCommentCount] = useState(post.comment); // コメント数用
    const [comments, setComments] = useState([]); // コメントリスト用
    const navigate = useNavigate();

    // Helper function to render text with clickable hashtags
    const renderTextWithHashtags = (text) => {
        if (!text) return null;
        // Match hashtags with 1-10 characters (including Japanese)
        const regex = /(#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]{1,10})/g;
        const parts = text.split(regex);

        return parts.map((part, index) => {
            if (part.match(regex)) {
                const tag = part.substring(1); // Remove the # symbol
                return (
                    <span
                        key={index}
                        className="hashtag"
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/search?q=${encodeURIComponent(part)}`);
                        }}
                    >
                        {part}
                    </span>
                );
            }
            return part;
        });
    };

    const handleLike = async () => {
        try {
            //いいねのAPI
            await axios.put(`/api/posts/${post._id}/like`, { userId: currentUser._id })

        } catch (err) {
            console.log(err);
        }
        setLikes(isLiked ? likes - 1 : likes + 1);
        setIsLiked(!isLiked);
    }

    const handledelete = async () => {
        try {
            //投稿の削除
            await axios.delete('/api/posts/' + post._id, { data: { userId: currentUser._id } });
            window.location.reload();
        } catch (err) {
            console.log(err);
        }
    }

    const handleCommentSubmit = async () => {
        if (commentText.trim() === "" && !commentFile) return;

        let imgUrl = null;
        if (commentFile) {
            const data = new FormData();
            const fileName = Date.now() + commentFile.name;
            data.append("name", fileName);
            data.append("file", commentFile);
            try {
                const res = await axios.post("/api/upload?type=comment", data);
                imgUrl = res.data.filePath;
            } catch (err) {
                console.error(err);
                return;
            }
        }

        try {
            const res = await axios.post(`/api/posts/${post._id}/comment`, {
                userId: currentUser._id,
                desc: commentText,
                img: imgUrl,
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
            setCommentFile(null);
            setCommentCount(commentCount + 1);
        } catch (err) {
            console.error("コメントの投稿に失敗しました", err);
        }
    };

    const handleCommentDelete = (commentId) => {
        setComments(comments.filter((c) => c._id !== commentId));
        setCommentCount(commentCount - 1);
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
        return () => document.removeEventListener("click", handleClickOutSide);
    }, []);

    useEffect(() => {
        const fetchComments = async () => {
            if (showComments) {
                try {
                    const res = await axios.get(`/api/posts/${post._id}/comments`);
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
                        {post.isClassroom ? (
                            <a href={post.courseLink} target="_blank" rel="noopener noreferrer">
                                <img src={
                                    post.userId?.profilePicture?.startsWith("http")
                                        ? post.userId.profilePicture
                                        : PUBLIC_FOLDER + (post.userId?.profilePicture?.startsWith("/assets/") ? post.userId.profilePicture.replace("/assets/", "") : (post.userId?.profilePicture || "person/noAvatar.png"))
                                }
                                    alt=""
                                    className="postProfileImg"
                                />
                            </a>
                        ) : (
                            <Link to={`/profile/${post.userId?.username}`}>
                                <img src={
                                    post.userId?.profilePicture?.startsWith("http")
                                        ? post.userId.profilePicture
                                        : PUBLIC_FOLDER + (post.userId?.profilePicture?.startsWith("/assets/") ? post.userId.profilePicture.replace("/assets/", "") : (post.userId?.profilePicture || "person/noAvatar.png"))
                                }
                                    alt=""
                                    className="postProfileImg"
                                />
                            </Link>
                        )}
                        {post.isClassroom ? (
                            <a href={post.courseLink} target="_blank" rel="noopener noreferrer" className='postUserName classroomLink'>
                                {post.userId?.username}
                            </a>
                        ) : (
                            <span className='postUserName'>
                                {post.userId?.username}
                            </span>
                        )}
                        <span className="postDate">
                            {format(post.createdAt)}
                        </span>
                    </div>
                    <div className="userMoreWrapper" ref={menuRef}>
                        <div className='postMenuButton' onClick={toggleMenu} role='button' tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleMenu(e); }}>
                            <MoreVert className='UsersMore' />
                        </div>
                        {showMenu && (
                            <div className="userMenu" onClick={(e) => e.stopPropagation()}>
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
                        {renderTextWithHashtags(post.desc)}
                    </span>
                    {post.img && (
                        <img
                            src={
                                post.img.startsWith("http")
                                    ? post.img
                                    : PUBLIC_FOLDER + (post.img.startsWith("/assets/") ? post.img.replace("/assets/", "") : post.img)
                            }
                            alt=""
                            className="postImg"
                        />
                    )}
                    {post.video && (
                        <video src={post.video} controls playsInline preload="metadata" className="postVideo" />
                    )}
                    {post.file && (
                        <div className="postFileWrapper">
                            <a href={post.file} className="postFileLink" target="_blank" rel="noreferrer">
                                <span style={{ marginRight: "5px" }}>📄</span>
                                ファイルをダウンロード
                            </a>
                        </div>
                    )}
                </div>
                <div className="postBottom">
                    <div className="postBottomLeft">
                        <FavoriteOutlined htmlColor='red' className='LikeIcon' sx={{ fontSize: '20px' }} onClick={() => handleLike()} />
                        <span className="postLikeCounter">
                            {likes}
                        </span>
                    </div>
                    <div className="postBottomRight" onClick={() => setShowComments(!showComments)} style={{ cursor: 'pointer' }}>
                        <span className="postCommentText">
                            <ChatBubbleOutline className='postCommentText' sx={{ fontSize: '20px' }} />
                            {commentCount}
                        </span>
                    </div>
                </div>
                {showComments && (
                    <div className="commentSection">
                        {/* コメント入力フォーム */}
                        <div className="commentInputContainer">
                            {commentFile && (
                                <div className="commentFilePreview">
                                    <img src={URL.createObjectURL(commentFile)} alt="" className="commentFilePreviewImg" />
                                    <Cancel className="commentFileCancel" onClick={() => setCommentFile(null)} />
                                </div>
                            )}
                            <div className="commentInputWrapper">
                                <label htmlFor={`comment-file-${post._id}`} className="commentFileIconLabel">
                                    <AttachFile className="commentFileIcon" />
                                    <input
                                        type="file"
                                        id={`comment-file-${post._id}`}
                                        style={{ display: 'none' }}
                                        accept=".png,.jpeg,.jpg"
                                        onChange={async (e) => {
                                            const file = e.target.files[0];
                                            if (!file) return;

                                            if (file.size > 100 * 1024 * 1024) {
                                                alert("File too large"); return;
                                            }

                                            // Compression
                                            const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1200, useWebWorker: true };
                                            try {
                                                const compressedFile = await imageCompression(file, options);
                                                const renamed = new File([compressedFile], file.name, { type: file.type });
                                                setCommentFile(renamed);
                                            } catch (err) {
                                                console.error(err);
                                            }
                                        }}
                                    />
                                </label>
                                <input
                                    placeholder="コメントを追加..."
                                    className="commentInput"
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value)}
                                />
                                <button className="commentSubmitButton" onClick={handleCommentSubmit}>送信</button>
                            </div>
                        </div>
                        {/* コメント一覧 */}
                        <div className="commentList">
                            {comments.map((comment) => (
                                <Comment key={comment._id} comment={comment} postId={post._id} onDelete={handleCommentDelete} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
