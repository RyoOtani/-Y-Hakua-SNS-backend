import "./messenger.css";
import Topbar from "../../components/topbar/topbarMain";
import Sidebar from "../../components/sidebar/sidebar";
import Conversation from "../../components/conversations/Conversation";
import Message from "../../components/message/Message";
import ChatHeader from "../../components/chatHeader/ChatHeader";
import Bottombar from "../../components/bottombar/bottombar";
import { Refresh, AttachFile, Cancel, Image, ArrowBack } from "@mui/icons-material";

import { useContext, useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthContext } from "../../state/AuthContext";
import axios from "axios";
import { SocketContext } from "../../state/SocketContext";

export default function Messenger() {
  const [conversations, setConversations] = useState([]);
  const [currentChat, setCurrentChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [arrivalMessage, setArrivalMessage] = useState(null);
  const [file, setFile] = useState(null);

  const [isTyping, setIsTyping] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const chatId = searchParams.get("chatId");

  const { socket, refreshUnreadMessages } = useContext(SocketContext); // Global socket
  const { user } = useContext(AuthContext);
  const scrollRef = useRef();

  const PF = process.env.REACT_APP_PUBLIC_FOLDER;

  // フレンド検索ロジック
  const handleSearchChange = async (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    if (val.trim()) {
      try {
        const res = await axios.get("/api/users/search?q=" + val);
        setSearchResults(res.data);
      } catch (err) {
        console.log(err);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleSelectFriend = async (friend) => {
    try {
      // すでに会話が存在するか確認
      let existingConv = conversations.find(c => c.members.includes(friend._id));

      if (!existingConv) {
        // 新規会話作成
        const res = await axios.post("/api/conversations", {
          senderId: user._id,
          receiverId: friend._id,
        });
        existingConv = res.data;
        setConversations(prev => [existingConv, ...prev]);
      }

      setCurrentChat(existingConv);
      setSearchParams({ chatId: existingConv._id });
      setSearchTerm("");
      setSearchResults([]);
    } catch (err) {
      console.log(err);
    }
  };

  // マウント時に未読カウントを最新化（Messengerを開いたタイミングで整合性を取る）
  useEffect(() => {
    refreshUnreadMessages();
  }, [user]);

  // Socket.io イベント設定
  useEffect(() => {
    if (!socket) return;

    // 受信メッセージ処理
    socket.on("getMessage", (data) => {
      setArrivalMessage({
        sender: {
          _id: data.senderId,
          username: data.senderName,
          profilePicture: data.senderProfilePicture,
        },
        text: data.text,
        conversationId: data.conversationId,
        createdAt: data.createdAt,
        text: data.text,
        conversationId: data.conversationId,
        createdAt: data.createdAt,
        read: false,
        attachments: data.attachments || [],
      });
    });

    // 既読通知処理
    socket.on("messageRead", (data) => {
      // 開いているチャットで既読がついたら反映
      if (currentChat?._id === data.conversationId) {
        setMessages((prev) =>
          prev.map((m) =>
            // 相手が読んだので自分のメッセージに既読をつける
            m.sender === user._id ? { ...m, read: true } : m
          )
        );
      }
    });

    // タイピング通知
    socket.on("userTyping", (data) => {
      if (currentChat?._id === data.conversationId) {
        setTypingUser(data.userId); // IDだけだと表示に使えないが、一旦フラグとして
      }
    });

    socket.on("userStopTyping", () => {
      setTypingUser(null);
    });



    // クリーンアップはSocketContextが行うので、ここではリスナー解除のみ行うのが理想だが
    // 複雑になるため、コンポーネントアンマウント時の明示的な解除は省略（再接続時に上書きされる挙動に依存）
    // 本来は .off するべき
    return () => {
      socket.off("getMessage");
      socket.off("messageRead");
      socket.off("userTyping");
      socket.off("userStopTyping");

    };
  }, [socket, currentChat, user]); // socketとcurrentChatに依存

  // メッセージ受信時の処理
  useEffect(() => {
    if (arrivalMessage) {
      // 現在開いているチャットからのメッセージなら追加
      if (currentChat?.members.includes(arrivalMessage.sender)) {
        setMessages((prev) => [...prev, arrivalMessage]);

        // 即座に既読にする
        const markRead = async () => {
          try {
            await axios.put(`/api/messages/${arrivalMessage.conversationId}/read`, {
              userId: user._id
            });
            // 相手に既読通知
            socket.emit("markAsRead", {
              conversationId: arrivalMessage.conversationId,
              readerId: user._id,
              senderId: arrivalMessage.sender,
            });
            // 未読カウントを更新
            refreshUnreadMessages();
          } catch (err) {
            console.log(err);
          }
        };
        markRead();
      }

      // 会話リストを更新（最新のメッセージを表示するため）
      updateConversationList(arrivalMessage);
    }
  }, [arrivalMessage, currentChat, socket]); // socket追加

  // 会話リストの並び替え・更新
  const updateConversationList = (message) => {
    setConversations(prev => {
      const targetIndex = prev.findIndex(c => c._id === message.conversationId);
      if (targetIndex === -1) return prev;

      const updatedConv = { ...prev[targetIndex] };
      updatedConv.lastMessageText = message.text;
      updatedConv.lastMessageAt = message.createdAt;

      // 開いていないチャットなら未読カウントを増やす
      if (currentChat?._id !== message.conversationId && message.sender !== user._id) {
        updatedConv.myUnreadCount = (updatedConv.myUnreadCount || 0) + 1;
      }

      // 更新した会話を先頭に移動
      const newConvs = [...prev];
      newConvs.splice(targetIndex, 1);
      return [updatedConv, ...newConvs];
    });
  };

  useEffect(() => {
    if (!user?._id) return;

    const getConversations = async () => {
      try {
        const res = await axios.get("/api/conversations/" + user._id);
        setConversations(res.data);
      } catch (err) {
        console.log(err);
      }
    };
    getConversations();
  }, [user?._id]);

  // Handle chatId from URL
  useEffect(() => {
    if (chatId && conversations.length > 0) {
      const selectedConv = conversations.find((c) => c._id === chatId);
      if (selectedConv) {
        setCurrentChat(selectedConv);
      }
    }
  }, [chatId, conversations]);

  useEffect(() => {
    const getMessages = async () => {
      try {
        if (currentChat) {
          const res = await axios.get("/api/messages/" + currentChat._id);
          setMessages(res.data);

          // 未読を一括既読にする
          if (currentChat.myUnreadCount > 0) {
            await axios.put(`/api/messages/read-all/${currentChat._id}`, {
              userId: user._id
            });
            // 会話リストの未読カウントもリセット
            setConversations(prev => prev.map(c =>
              c._id === currentChat._id ? { ...c, myUnreadCount: 0 } : c
            ));
            // 未読カウントを更新
            refreshUnreadMessages();
          }
        }
      } catch (err) {
        console.log(err);
      }
    };
    getMessages();
  }, [currentChat]);

  const handleRefreshMessages = async () => {
    if (!currentChat) return;
    try {
      setIsRefreshing(true);
      const res = await axios.get("/api/messages/" + currentChat._id);
      setMessages(res.data);
    } catch (err) {
      console.log(err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // 2分ごとに自動更新（ポーリング）
  useEffect(() => {
    if (!user?._id) return;

    const refreshData = async () => {
      try {
        // 会話リストを更新
        const convRes = await axios.get("/api/conversations/" + user._id);
        setConversations(convRes.data);

        // 現在開いているチャットのメッセージを更新
        if (currentChat) {
          const msgRes = await axios.get("/api/messages/" + currentChat._id);
          setMessages(msgRes.data);
        }
      } catch (err) {
        console.log("Auto-refresh error:", err);
      }
    };

    // 2分 = 120000ミリ秒
    const intervalId = setInterval(refreshData, 120000);

    // クリーンアップ：コンポーネントがアンマウントされたらインターバルをクリア
    return () => clearInterval(intervalId);
  }, [user?._id, currentChat]);

  // タイピングハンドリング
  const handleTyping = (e) => {
    setNewMessage(e.target.value);

    if (!isTyping) {
      if (socket) {
        setIsTyping(true);
        const receiverId = currentChat.members.find(member => member !== user._id);
        socket.emit("typing", {
          conversationId: currentChat._id,
          userId: user._id,
          receiverId
        });

        setTimeout(() => {
          setIsTyping(false);
          socket.emit("stopTyping", {
            conversationId: currentChat._id,
            userId: user._id,
            receiverId
          });
        }, 3000);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() && !file) return;

    if (!socket) {
      console.error("Socket not connected");
      return;
    }

    let attachments = [];
    if (file) {
      const data = new FormData();
      const fileName = Date.now() + file.name;
      data.append("name", fileName);
      data.append("file", file);
      try {
        const res = await axios.post("/api/upload?type=chat", data);
        const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
        attachments.push({
          type: type,
          url: res.data.filePath,
          filename: file.name
        });
      } catch (err) {
        console.error(err);
        return;
      }
    }

    const message = {
      sender: user._id,
      text: newMessage,
      conversationId: currentChat._id,
      attachments: attachments,
    };

    const receiverId = currentChat.members.find(
      (member) => member !== user._id
    );

    socket.emit("sendMessage", {
      senderId: user._id,
      senderName: user.username,
      senderProfilePicture: user.profilePicture,
      receiverId,
      text: newMessage,
      conversationId: currentChat._id,
      attachments: attachments,
    });

    try {
      const res = await axios.post("/api/messages", message);
      setMessages([...messages, res.data]);
      setNewMessage("");
      setFile(null); // Reset file

      // 自分の会話リストを更新
      setConversations(prev => {
        const targetIndex = prev.findIndex(c => c._id === currentChat._id);
        if (targetIndex === -1) return prev; // 念のため

        const updatedConv = { ...prev[targetIndex] };
        updatedConv.lastMessageText = newMessage || (attachments.length > 0 ? "Sent an attachment" : "");
        updatedConv.lastMessageAt = Date.now();

        const newConvs = [...prev];
        newConvs.splice(targetIndex, 1);
        return [updatedConv, ...newConvs];
      });

    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      <Topbar />
      <div className="messengerContainer">
        <div className="messengerSidebar">
          <Sidebar />
        </div>
        <div className="messenger">
          <div className={`chatMenu ${currentChat ? "hidden-mobile" : ""}`}>
            <div className="chatMenuWrapper">
              <div className="chatMenuHeader">
                <span className="chatMenuTitle">Conversations</span>
                <input
                  placeholder="Search friends..."
                  className="chatMenuInput"
                  value={searchTerm}
                  onChange={handleSearchChange}
                />
              </div>
              <div className="chatConversationList">
                {searchTerm ? (
                  <div className="searchFriendResults">
                    {searchResults.length > 0 ? (
                      searchResults.map((u) => (
                        <div key={u._id} className="searchFriendItem" onClick={() => handleSelectFriend(u)}>
                          <img
                            src={
                              u.profilePicture
                                ? u.profilePicture.startsWith("http")
                                  ? u.profilePicture
                                  : PF + (u.profilePicture.startsWith("/assets/") ? u.profilePicture.replace("/assets/", "") : u.profilePicture)
                                : PF + "person/noAvatar.png"
                            }
                            alt=""
                            className="searchFriendImg"
                          />
                          <span className="searchFriendName">{u.name || u.username}</span>
                        </div>
                      ))
                    ) : (
                      <div className="noResults">No friends found</div>
                    )}
                  </div>
                ) : (
                  conversations.map((c) => (
                    <div
                      onClick={() => {
                        setCurrentChat(c);
                        setSearchParams({ chatId: c._id });
                      }}
                      key={c._id}
                      className={currentChat?._id === c._id ? "selectedConversation" : ""}
                    >
                      <Conversation conversation={c} currentUser={user} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className={`chatBox ${!currentChat ? "hidden-mobile" : ""}`}>
            <div className="chatBoxWrapper">
              {currentChat ? (
                <>
                  <div className="chatBoxHeader">
                    {/* 現在の会話相手の情報を表示 */}
                    {(() => {
                      const friendId = currentChat.members.find(m => m !== user._id);
                      // Conversationsから情報を探すか、APIで取得した情報を使う（ここでは簡易的にConversationコンポーネント内と同様の取得はせず、Conversationをクリックした時にデータが揃うようにするのが理想）
                      // 一旦、Conversation内でのデータ取得を再利用するか、ここで再度取得する
                      // 暫定的に、Conversationリストの中から見つける
                      // 実際には Conversation.jsx をラップして情報を抽出するか、currentPartner stateを持たせるのが良い
                    })()}
                    <ChatHeader conversation={currentChat} currentUser={user} PF={PF} />
                  </div>
                  <div className="chatBoxRefresh">
                    <div className="chatHeaderMobileBack">
                      <ArrowBack
                        onClick={() => {
                          setCurrentChat(null);
                          setSearchParams({});
                        }}
                        className="chatBackIcon"
                      />
                    </div>
                    <div
                      className={`chatRefreshButton ${isRefreshing ? 'refreshing' : ''}`}
                      onClick={handleRefreshMessages}
                      title="Refresh Messages"
                    >
                      <Refresh className="chatRefreshIcon" />
                      <span className="chatRefreshText">New Messages</span>
                    </div>
                  </div>
                  <div className="chatBoxTop">
                    {messages.map((m) => (
                      <div ref={scrollRef} key={m._id}>
                        <Message
                          message={m}
                          own={(m.sender?._id || m.sender) === user._id}
                          setMessages={setMessages} // メッセージ削除更新用
                        />
                      </div>
                    ))}
                    {typingUser && <div className="typingIndicator">Someone is typing...</div>}
                  </div>
                  {file && (
                    <div className="chatFilePreviewContainer">
                      {file.type.startsWith("image/") ? (
                        <img src={URL.createObjectURL(file)} alt="" className="chatFilePreviewImg" />
                      ) : (
                        <div className="chatFilePreview">{file.name}</div>
                      )}
                      <Cancel className="chatFileCancel" onClick={() => setFile(null)} />
                    </div>
                  )}
                  <div className="chatBoxBottom">
                    <label htmlFor="chatFile" className="chatFileLabel">
                      <AttachFile className="chatFileIcon" />
                      <input
                        type="file"
                        id="chatFile"
                        style={{ display: "none" }}
                        accept=".png, .jpeg, .jpg, .gif, .mp4, .mov, .avi, .webm, .pdf, .doc, .docx, .zip, .txt"
                        onChange={(e) => {
                          const f = e.target.files[0];
                          if (f) {
                            if (f.size > 100 * 1024 * 1024) {
                              alert("File size too large (max 100MB)");
                              e.target.value = "";
                              return;
                            }
                            setFile(f);
                          }
                        }}
                      />
                    </label>
                    <textarea
                      className="chatMessageInput"
                      placeholder="Type a message..."
                      onChange={handleTyping}
                      value={newMessage}
                    ></textarea>
                    <button className="chatSubmitButton" onClick={handleSubmit}>
                      Send
                    </button>
                  </div>
                </>
              ) : (
                <div className="noConversationOverlay">
                  <span className="noConversationText">
                    Select a chat to start messaging
                  </span>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
      <div className="bottombar">
        <Bottombar />
      </div>
    </>
  );
}