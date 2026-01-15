import React, { useState, useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './rightbar.css';
import axios from 'axios';
import { AuthContext } from '../../state/AuthContext';
import { UpdateSuccess } from '../../state/AuthActions';

export default function Rightbar({ user }) {
  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";

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
        <div className="RigthtbarHint">
          最新の情報をみたい場合は画面をリフレッシュしてください
        </div>


      </>
    )
  }

  const ProfileRightbar = () => {
    const [friends, setFriends] = useState([]);

    useEffect(() => {
      const getFriends = async () => {
        try {
          if (!user._id) return;
          const friendList = await axios.get("/api/users/friends/" + user._id);
          setFriends(friendList.data);
        } catch (err) {
          console.log(err);
        }
      };
      getFriends();
    }, [user]);

    return (
      <>
        <h4 className="rightbarTitle">Following</h4>
        <div className="rightbarFollowings">
          {friends.map((friend) => (
            <Link
              to={"/profile/" + friend.username}
              style={{ textDecoration: "none" }}
              key={friend._id}
            >
              <div className="rightbarFollowing">
                <img
                  src={
                    friend.profilePicture
                      ? friend.profilePicture
                      : PUBLIC_FOLDER + "person/noAvatar.png"
                  }
                  alt=""
                  className="rightbarFollowingImg"
                />
                <span className="rightbarFollowingName">{friend.username}</span>
              </div>
            </Link>
          ))}
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