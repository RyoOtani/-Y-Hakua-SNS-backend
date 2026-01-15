import React, { useEffect, useState, useContext } from 'react'
import { AuthContext } from '../../state/AuthContext';
import { UpdateSuccess } from '../../state/AuthActions';
import Topbar from '../../components/topbar/topbarMain'
import Sidebar from '../../components/sidebar/sidebar'
import Timeline from '../../components/timeline/timeline'
import Rightbar from '../../components/rightbar/rightbar'
import './profile.css'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import Bottombar from '../../components/bottombar/bottombar'

export default function Profile() {
  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER;

  const [user, setUser] = useState({});
  const username = useParams().username;

  useEffect(() => {
    const fetchUser = async () => {
      const response = await axios.get(`/api/users?username=${username}`);
      //console.log(response.data);
      setUser(response.data);
    }
    fetchUser();
  }, [username]);

  const { user: currentUser, dispatch } = useContext(AuthContext);
  const [isFollowed, setIsFollowed] = useState(false);

  useEffect(() => {
    if (currentUser && user && currentUser.following) {
      setIsFollowed(currentUser.following.includes(user._id));
    }
  }, [currentUser, user]);

  const handleClick = async () => {
    try {
      if (isFollowed) {
        await axios.put(`/api/users/${user._id}/unfollow`, { userId: currentUser._id });
        const newFollowings = currentUser.following.filter(followingId => followingId !== user._id);
        dispatch(UpdateSuccess({ ...currentUser, following: newFollowings }));
      } else {
        await axios.put(`/api/users/${user._id}/follow`, { userId: currentUser._id });
        const newFollowings = [...currentUser.following, user._id];
        dispatch(UpdateSuccess({ ...currentUser, following: newFollowings }));
      }
      setIsFollowed(!isFollowed);
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <>
      <Topbar />

      <div className='profileContainer'>
        <Sidebar className='sidebar' />

        <div className="profileRight">
          <div className="profileRightTop">
            <div className="profileCover">
              <img
                src={
                  user.coverPicture
                    ? user.coverPicture.startsWith("http")
                      ? user.coverPicture
                      : PUBLIC_FOLDER + (user.coverPicture.startsWith("/assets/") ? user.coverPicture.replace("/assets/", "") : user.coverPicture)
                    : PUBLIC_FOLDER + "post/3.jpeg"
                }
                alt="" className="profileCoverImg" />
              <img src={
                user.profilePicture?.startsWith("http")
                  ? user.profilePicture
                  : PUBLIC_FOLDER + "person/noAvatar.png"
              }
                alt="" className="profileUserImg" />
            </div>
            <div className="profileInfo">
              <div className="profileNameWrapper">
                <h4 className="profileInfoName">{user.username}</h4>
                {user.username !== currentUser.username && (
                  <button
                    className={`followButton ${isFollowed ? "followed" : ""}`}
                    onClick={handleClick}
                  >
                    {isFollowed ? "Unfollow" : "Follow"}
                  </button>
                )}
                <span className="profileInfoDesc">{user.desc}</span>
              </div>
            </div>
          </div>
          <div className="profileRightBottom">
            <Timeline username={username} />
            <Rightbar user={user} />
          </div>
        </div>
      </div>
      <div className="bottombar">
        <Bottombar />
      </div>
    </>
  )
}
