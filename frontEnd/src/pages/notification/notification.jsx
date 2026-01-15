import React, { useContext, useEffect, useState } from "react";
import axios from "axios";
import { AuthContext } from "../../state/AuthContext";
import { SocketContext } from "../../state/SocketContext";
import Topbar from "../../components/topbar/topbarMain";
import Sidebar from "../../components/sidebar/sidebar";
import Bottombar from "../../components/bottombar/bottombar";
import { format } from "timeago.js";
import { Link } from "react-router-dom";
import { TrendingUp } from "@mui/icons-material";
import "./notification.css";

export default function Notification() {
    const { user } = useContext(AuthContext);
    const { resetUnreadNotifications } = useContext(SocketContext);
    const [notifications, setNotifications] = useState([]);
    const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER;

    useEffect(() => {
        const fetchNotifications = async () => {
            try {
                const res = await axios.get(`/api/notifications/${user._id}`);
                setNotifications(res.data);

                // ページを開いた時点で未読カウントをリセットする（または既読にするAPIを呼ぶ）
                resetUnreadNotifications();

                // すべての通知を既読にする
                await axios.put(`/api/notifications/read-all/${user._id}`);
            } catch (err) {
                console.error(err);
            }
        };
        fetchNotifications();
    }, [user, resetUnreadNotifications]);

    return (
        <>
            <Topbar />
            <div className="notificationContainer">
                <div className="sidebar">
                    <Sidebar />
                </div>
                <div className="notificationRight">
                    <div className="notificationWrapper">
                        <div className="notificationHeader">
                            <h2 className="notificationTitle">Notifications</h2>
                            <Link to="/ranking" style={{ textDecoration: "none" }}>
                                <div className="rankingLinkButton">
                                    <TrendingUp className="rankingIcon" />
                                    <span>Trending Ranking</span>
                                </div>
                            </Link>
                        </div>
                        {notifications.length === 0 && <span className="noNotifications">No notifications yet.</span>}
                        <ul className="notificationList">
                            {notifications.map((n) => (
                                <li key={n._id} className={`notificationItem ${!n.isRead ? "unread" : ""}`}>
                                    <img
                                        src={n.sender.profilePicture || PUBLIC_FOLDER + "person/noAvatar.png"}
                                        alt=""
                                        className="notificationImg"
                                    />
                                    <div className="notificationInfo">
                                        <span className="notificationText">
                                            <span className="notificationUsername">{n.sender.username}</span>
                                            {n.type === "like" && " liked your post."}
                                            {n.type === "comment" && " commented on your post."}
                                            {n.type === "follow" && " started following you."}
                                        </span>
                                        <span className="notificationTime">{format(n.createdAt)}</span>
                                    </div>
                                    {n.post && n.post.img && (
                                        <img src={PUBLIC_FOLDER + n.post.img} alt="" className="notificationPostImg" />
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <Bottombar />
        </>
    );
}
