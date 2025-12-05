import React from 'react';
import './rightbar.css';

export default function Rightbar( { user } ) {
  const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;
  
  const HomeRightbar = () => {
    return (
      <>
        
          <div className="eventContainer">
            <img src="assets/star.png" alt="" className="ClassNotification" />
            <span className="eventText">
              <b className="eventDate">
                New timetable change
              </b>
            </span>
          </div>
          <img src="assets/event.jpeg" alt="" className="eventImg" />
          <h4 className="rightbarTitle">Upcoming Events</h4>
          <ul className="friendList">
            <span className="FriendNameList">Classmates</span>
            <div className="FriendListDiv">
              <li className="rightbarFriend">
                <div className="rightbarProfileImgContainer">
                  <img src="assets/person/2.jpeg" alt="" className="rightbarProfileImg" />
                </div>
                <span className="rightbarUsername">
                  Ashidate
                </span>
              </li>
              <li className="rightbarFriend">
                <div className="rightbarProfileImgContainer">
                  <img src="assets/person/3.jpeg" alt="" className="rightbarProfileImg" />
                </div>
                <span className="rightbarUsername">
                  Otaka
                </span>
              </li>
            </div>
          </ul>
          <p className="promotionTitple">先生からのお知らせ</p>
          <img src="/promotion/promotion1.jpeg" alt="" className="rightbarPromotionImg" />
          <p className="promotionName">今日の体育は体育館でやります</p>
          <img src="assets/promotion/promotion2.jpeg" alt="" className="rightbarPromotionImg" />
          <p className="promotionName">明日の化学は実験室でやります</p>
          <img src="assets/promotion/promotion3.jpeg" alt="" className="rightbarPromotionImg" />
          <p className="promotionName">明日の保険は発表です</p>
        
      </>
    )
  }
  
  const ProfileRightbar = () => {
    return (
      <>
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