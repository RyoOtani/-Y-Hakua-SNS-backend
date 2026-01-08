import { createContext, useContext, useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { AuthContext } from "./AuthContext";
import axios from "axios";

export const SocketContext = createContext();

export const SocketContextProvider = ({ children }) => {
    const { user } = useContext(AuthContext);
    const socket = useRef();
    const [unreadMessages, setUnreadMessages] = useState(0);
    const [unreadNotifications, setUnreadNotifications] = useState(0);

    // 1. Socket接続とユーザー登録
    useEffect(() => {
        if (user) {
            // すでに接続があれば切断してから再接続する
            if (socket.current) {
                socket.current.disconnect();
            }

            socket.current = io("ws://localhost:8800");
            socket.current.emit("addUser", user._id);

            // 初期未読メッセージ数の取得
            const fetchUnread = async () => {
                try {
                    const res = await axios.get(`/api/conversations/unread-total/${user._id}`);
                    setUnreadMessages(res.data.total);
                } catch (err) {
                    console.error("Failed to fetch unread messages:", err);
                }
            };
            fetchUnread();

            // 初期通知数の取得
            const fetchNotifications = async () => {
                try {
                    const res = await axios.get(`/api/notifications/${user._id}`);
                    // 未読の通知をカウント
                    const unreadCount = res.data.filter(n => !n.isRead).length;
                    setUnreadNotifications(unreadCount);
                } catch (err) {
                    console.error("Failed to fetch notifications:", err);
                }
            };
            fetchNotifications();

        } else {
            // ログアウト時は切断
            if (socket.current) {
                socket.current.disconnect();
                socket.current = null;
            }
        }
    }, [user?._id]); // user全体ではなく _id の変更をトリガーにする

    // 2. イベントリスナーの設定
    useEffect(() => {
        const currentSocket = socket.current;
        if (currentSocket) {
            const handleMessage = () => {
                setUnreadMessages((prev) => prev + 1);
            };
            const handleNewPost = () => {
                setUnreadNotifications((prev) => prev + 1);
            };
            const handleNotification = () => {
                setUnreadNotifications((prev) => prev + 1);
            };

            currentSocket.on("getMessage", handleMessage);
            currentSocket.on("newPost", handleNewPost);
            currentSocket.on("getNotification", handleNotification);

            // クリーンアップ処理: イベントリスナーを解除する
            return () => {
                currentSocket.off("getMessage", handleMessage);
                currentSocket.off("newPost", handleNewPost);
                currentSocket.off("getNotification", handleNotification);
            };
        }
    }, [user?._id]); // Socket接続が確立された後にリスナーを設定する 

    // 他のコンポーネントから未読数をリセットするための関数
    const resetUnreadMessages = () => setUnreadMessages(0); // 簡易的
    const resetUnreadNotifications = () => setUnreadNotifications(0);

    // 正確な値を再取得する関数
    const refreshUnreadMessages = async () => {
        if (!user) return;
        try {
            const res = await axios.get(`/api/conversations/unread-total/${user._id}`);
            setUnreadMessages(res.data.total);
        } catch (err) {
            console.error(err);
        }
    }

    return (
        <SocketContext.Provider
            value={{
                socket: socket.current,
                unreadMessages,
                unreadNotifications,
                refreshUnreadMessages,
                resetUnreadNotifications,
            }}
        >
            {children}
        </SocketContext.Provider>
    );
};
