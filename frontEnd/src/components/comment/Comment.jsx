import React from 'react';
import { Link } from 'react-router-dom';
import './comment.css';
import { format } from 'timeago.js';

export default function Comment({ comment }) {
  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER;

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
        </div>
        <p className="commentDesc">{comment.desc}</p>
      </div>
    </div>
  );
}
