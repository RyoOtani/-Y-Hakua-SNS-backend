import axios from "axios";
import { useEffect, useState } from "react";
import "./conversation.css";

export default function Conversation({ conversation, currentUser }) {
  const [user, setUser] = useState(null);
  const PF = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";

  useEffect(() => {
    // メンバーの中から自分以外のユーザーを探す。オブジェクトかIDのどちらの可能性もある
    const friend = conversation.members.find((m) => (m._id || m) !== currentUser._id);

    if (friend && typeof friend === "object" && friend.username) {
      // すでにオブジェクトとして情報がある（populate済み）場合はそれを使用
      setUser(friend);
    } else if (friend) {
      // ID文字列の場合は、API経由で情報を取得
      const friendId = friend._id || friend;
      const getUser = async () => {
        try {
          const res = await axios.get("/api/users?userId=" + friendId);
          setUser(res.data);
        } catch (err) {
          console.log(err);
        }
      };
      getUser();
    }
  }, [currentUser, conversation]);

  // 時間フォーマット関数
  const formatTime = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const now = new Date();

    // 今日なら時刻のみ
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // 昨日以前なら日付
    return date.toLocaleDateString();
  };

  const isUnread = conversation.myUnreadCount > 0;

  return (
    <div className={`conversation ${isUnread ? "unread" : ""}`}>
      <div className="conversationWrapper">
        <div className="conversationImgContainer">
          <img
            className="conversationImg"
            src={
              user?.profilePicture
                ? user.profilePicture.startsWith("http")
                  ? user.profilePicture
                  : PF + (user.profilePicture.startsWith("/assets/") ? user.profilePicture.replace("/assets/", "") : user.profilePicture)
                : PF + "person/noAvatar.png"
            }
            alt=""
          />
        </div>
        <div className="conversationInfo">
          <div className="conversationTop">
            <span className={`conversationName ${isUnread ? "unreadText" : ""}`}>
              {user?.name || user?.username}
            </span>
            <span className="conversationTime">
              {formatTime(conversation.lastMessageAt)}
            </span>
          </div>
          <div className="conversationBottom">
            <p className={`conversationLastMessage ${isUnread ? "unreadText" : ""}`}>
              {conversation.lastMessageText || "No messages yet"}
            </p>
            {isUnread && (
              <span className="conversationUnreadBadge">
                {conversation.myUnreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}