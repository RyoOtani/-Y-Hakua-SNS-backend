import "./message.css";
import { format } from "timeago.js";
import { MoreVert, Edit, Delete, DoneAll, Done } from "@mui/icons-material";
import { useState } from "react";
import axios from "axios";

export default function Message({ message, own, setMessages }) {
  const PF = process.env.REACT_APP_PUBLIC_FOLDER;
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);

  // senderがオブジェクトか文字列かを判定してIDを取得
  const getSenderId = () => message.sender?._id || message.sender;

  const handleDelete = async () => {
    try {
      if (window.confirm("このメッセージを削除しますか？")) {
        await axios.delete(`/api/messages/${message._id}`, {
          data: { userId: getSenderId() },
        });
        // UIから削除（リロードなしで反映するため、親コンポーネントで管理するのが理想だが簡略化）
        window.location.reload();
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleEdit = async () => {
    try {
      const res = await axios.put(`/api/messages/${message._id}`, {
        userId: getSenderId(),
        text: editText,
      });
      message.text = res.data.text;
      message.edited = true;
      setIsEditing(false);
      setShowMenu(false);
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <div
      className={own ? "message own" : "message"}
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
    >
      <div className="messageTop">
        {!own && (
          <img
            className="messageImg"
            src={
              message.sender?.profilePicture
                ? message.sender.profilePicture.startsWith("http")
                  ? message.sender.profilePicture
                  : PF + (message.sender.profilePicture.startsWith("/assets/") ? message.sender.profilePicture.replace("/assets/", "") : message.sender.profilePicture)
                : PF + "person/noAvatar.png"
            }
            alt=""
          />
        )}

        <div className="messageContent">
          {isEditing ? (
            <div className="messageEditInputContainer">
              <input
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="messageEditInput"
                autoFocus
              />
              <button onClick={handleEdit} className="messageEditButton save">保存</button>
              <button onClick={() => setIsEditing(false)} className="messageEditButton cancel">キャンセル</button>
            </div>
          ) : (
            <p className="messageText">
              {message.text}
              {message.edited && <span className="messageEditedLabel">(編集済み)</span>}
            </p>
          )}

          <div className="messageMeta">
            <span className="messageTime">{format(message.createdAt)}</span>
            {own && (
              <span className="messageReadStatus">
                {message.read ? (
                  <DoneAll className="readIcon read" />
                ) : (
                  <Done className="readIcon sent" />
                )}
              </span>
            )}
          </div>
        </div>

        {own && showMenu && !isEditing && (
          <div className="messageActions">
            <Edit
              className="messageActionIcon"
              onClick={() => setIsEditing(true)}
              fontSize="small"
            />
            <Delete
              className="messageActionIcon delete"
              onClick={handleDelete}
              fontSize="small"
            />
          </div>
        )}
      </div>
    </div>
  );
}