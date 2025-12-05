import React, { useEffect, useState}  from 'react'
import Topbar from '../../components/Topbar/topbar'
import Sidebar from '../../components/sidebar/sidebar'
import Timeline from '../../components/timeline/timeline'
import Rightbar from '../../components/Rightbar/rightbar'
import './profile.css'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import Bottombar from '../../components/bottombar/bottombar'

export default function Profile() {
  const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;

  const [user, setUser] = useState({});
  const username = useParams().username;
    
  useEffect(() => {
      const fetchUser = async () => {
        const response = await axios.get(`/users?username=${username}`);
        //console.log(response.data);
        setUser(response.data);
      }
      fetchUser();
  }, [username]);
  
  return (
    <>
      <Topbar />
      
      <div className='profileContainer'>
        <Sidebar className='sidebar' />

        <div className="profileRight">
            <div className="profileRightTop">
                <div className="profileCover">
                    <img src={user.coverPicture || PUBLIC_FOLDER + "/post/3.jpeg"} alt="" className="profileCoverImg" />
                    <img src={
                      user.profilePicture
                      ? PUBLIC_FOLDER + user.profilePicture
                      : PUBLIC_FOLDER + "/person/noAvatar.png"
                      } alt="" className="profileUserImg" />
                </div>
                <div className="profileInfo">
                    <h4 className="profileInfoName">{user.username}</h4>
                    <span className="profileInfoDesc">{user.desc}</span>
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
