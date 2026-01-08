import React, { useState, useContext, useEffect } from 'react';
import './rightbar.css';
import axios from 'axios';
import { AuthContext } from '../../state/AuthContext';
import { UpdateSuccess } from '../../state/AuthActions';

export default function Rightbar( { user } ) {
  const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;
  
  const HomeRightbar = () => {
    const [courses, setCourses] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Function to fetch classroom courses
    const handleSync = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Use the proxy to call the backend API
        const res = await axios.get("/classroom/courses"); 
        setCourses(res.data);
      } catch (err) {
        console.error("Failed to fetch classroom courses:", err);
        if (err.response && err.response.status === 401) {
          // Check for a specific message if needed, but 401 from this endpoint implies token issue
          // Redirect to Google OAuth to re-authenticate and get a new refresh token
          window.location.href = "/api/auth/google"; 
        } else {
          setError("コースの取得に失敗しました。Googleアカウントでログインしているか確認してください。"); // Set a user-friendly error message
        }
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <>
        {/* Google Classroom Integration Section */}
        <div className="classroomContainer">
          <h4 className="rightbarTitle">Google Classroom</h4>
          <button className="rightbarButton" onClick={handleSync} disabled={isLoading}>
            {isLoading ? "同期中..." : "クラスを同期"}
          </button>
          {error && <span className="errorMessage">{error}</span>}
          <ul className="classroomList">
            {courses.length > 0 ? (
              courses.map((course) => (
                <li key={course.id} className="classroomListItem">
                  {course.name}
                </li>
              ))
            ) : (
              !isLoading && !error && <span className="noCoursesText">同期ボタンを押してクラスを表示</span>
            )}
          </ul>
        </div>
        <hr className="rightbarHr" />

        
      </>
    )
  }
  
  const ProfileRightbar = () => {
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
          await axios.put(`/users/${user._id}/unfollow`, { userId: currentUser._id });
          const newFollowings = currentUser.following.filter(followingId => followingId !== user._id);
          dispatch(UpdateSuccess({ ...currentUser, following: newFollowings }));
        } else {
          await axios.put(`/users/${user._id}/follow`, { userId: currentUser._id });
          const newFollowings = [...currentUser.following, user._id];
          dispatch(UpdateSuccess({ ...currentUser, following: newFollowings }));
        }
      } catch (err) {
        console.log(err);
      }
    };

    return (
      <>
        {user.username !== currentUser.username && (
          <button className="rightbarFollowButton" onClick={handleClick}>
            {isFollowed ? "Unfollow" : "Follow"}
          </button>
        )}
        <h4 className="rightbarTitle">User Information</h4>
        <div className="rightbarInfo">
          <div className="rightbarInfoItem">
            <span className="rightbarInfoKey">City:</span>
            <span className="rightbarInfoValue">Tokyo</span>
          </div>
          <div className="rightbarFollowing">
            <img src={`${PUBLIC_FOLDER}/person/1.jpeg`} alt="" className="rightbarFollowingImg" />
            <span className="rightbarFollowingName">
              {user.username}
            </span>
          </div>
          <div className=".rightbarFriend">
            <div className="rightbarFollowing">
              <img src={`${PUBLIC_FOLDER}/person/2.jpeg`} alt="" className="rightbarFollowingImg" />
              <span className="rightbarFollowingName">Ashidate</span>
            </div>
            <div className="rightbarFollowing">
              <img src={`${PUBLIC_FOLDER}/person/3.jpeg`} alt="" className="rightbarFollowingImg" />
              <span className="rightbarFollowingName">Otaka</span>
          </div>
          </div>          
        </div>
      </>
    )
  }

  return (
    <div className="rightbar">
      <div className="rightbarWrapper">
        {user ? <ProfileRightbar /> : <HomeRightbar />}
      </div>
    </div>
  )
}