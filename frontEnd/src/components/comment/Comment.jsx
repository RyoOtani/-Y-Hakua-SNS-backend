import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import './comment.css';
import { format } from 'timeago.js';
import { AuthContext } from '../../state/AuthContext';
import { Delete } from '@mui/icons-material';
import axios from 'axios';

export default function Comment({ comment, postId, onDelete }) {
  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER;
  const { user: currentUser } = useContext(AuthContext);

  const handleDelete = async () => {
    if (window.confirm("コメントを削除しますか？")) {
      try {
        await axios.delete(`/api/posts/${postId}/comment/${comment._id}`, {
          data: { userId: currentUser._id },
        });
        onDelete(comment._id);
      } catch (err) {
        console.error(err);
        alert("削除に失敗しました");
      }
    }
  };

  return (
    <div className="commentItem">
      <Link to={`/profile/${comment.userId.username}`}>
        <img
          src={
            comment.userId.profilePicture
              ? comment.userId.profilePicture
              : PUBLIC_FOLDER + 'person/noAvatar.png'
          }
          alt=""
          className="commentProfileImg"
        />
      </Link>
      <div className="commentBody">
        <div className="commentTop">
          <span className="commentUsername">{comment.userId.username}</span>
          <span className="commentDate">{format(comment.createdAt)}</span>
          {comment.userId._id === currentUser._id && (
            <Delete
              className="commentDeleteIcon"
              onClick={handleDelete}
              sx={{ fontSize: 16, cursor: 'pointer', marginLeft: 'auto', color: '#888' }}
            />
          )}
        </div>
        <p className="commentDesc">{comment.desc}</p>
        {comment.img && (
          <img
            src={comment.img}
            className="commentImg"
            alt="attachment"
            onClick={() => window.open(comment.img, '_blank')}
          />
        )}
      </div>
    </div>
  );
}
