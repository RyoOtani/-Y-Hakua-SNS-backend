import React, { useContext, useEffect, useState } from "react";
import "./setting.css";
import Sidebar from "../../components/sidebar/sidebar";
import Topbar from "../../components/topbar/topbarMain";
import Bottombar from "../../components/bottombar/bottombar";
import { AuthContext } from "../../state/AuthContext";
import axios from "axios";
import { UpdateSuccess } from "../../state/AuthActions";

const themeColors = {
  light: "#ffffff",
  dark: "#15202b",
};

export default function Setting() {
  const { user: currentUser, dispatch } = useContext(AuthContext);
  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";

  // State for theme name ('light' or 'dark')
  const [theme, setTheme] = useState(
    currentUser.backgroundColor === themeColors.dark ? "dark" : "light"
  );
  const [font, setFont] = useState(currentUser.font || "Arial");
  const [desc, setDesc] = useState(currentUser.desc || "");
  const [coverPicture, setCoverPicture] = useState(null);
  const [coverPicturePreview, setCoverPicturePreview] = useState(
    currentUser.coverPicture
  );

  // Preview the theme immediately when the user changes it in the dropdown
  useEffect(() => {
    // Apply preview
    document.body.style.backgroundColor = themeColors[theme];
    if (theme === "dark") {
      document.body.classList.add("dark-theme");
    } else {
      document.body.classList.remove("dark-theme");
    }

    // Cleanup: revert to the actual user's saved theme if the component unmounts
    // or if the selection changes (the next effect call will apply the new preview)
    return () => {
      const savedTheme = (currentUser?.backgroundColor || "").toLowerCase() === themeColors.dark.toLowerCase() ? "dark" : "light";
      document.body.style.backgroundColor = currentUser?.backgroundColor || themeColors.light;
      if (savedTheme === "dark") {
        document.body.classList.add("dark-theme");
      } else {
        document.body.classList.remove("dark-theme");
      }
    };
  }, [theme, currentUser?.backgroundColor]);

  // Synchronize local state when currentUser changes (e.g., after fresh fetch in App.js)
  useEffect(() => {
    if (currentUser) {
      setTheme(currentUser.backgroundColor === themeColors.dark ? "dark" : "light");
      setFont(currentUser.font || "Arial");
      setDesc(currentUser.desc || "");
      setCoverPicturePreview(currentUser.coverPicture);
    }
  }, [currentUser]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setCoverPicture(file);
      setCoverPicturePreview(URL.createObjectURL(file));
    }
  };

  const [followers, setFollowers] = useState([]);
  const [followings, setFollowings] = useState([]);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowings, setShowFollowings] = useState(false);

  // Fetch followers and followings
  useEffect(() => {
    const fetchFollowLists = async () => {
      try {
        const [followersRes, followingsRes] = await Promise.all([
          axios.get("/api/users/followers/" + currentUser._id),
          axios.get("/api/users/friends/" + currentUser._id),
        ]);
        setFollowers(followersRes.data);
        setFollowings(followingsRes.data);
      } catch (err) {
        console.error("Error fetching follow lists:", err);
      }
    };
    if (currentUser._id) {
      fetchFollowLists();
    }
  }, [currentUser._id]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    let coverPictureUrl = currentUser.coverPicture;

    if (coverPicture) {
      const data = new FormData();
      const fileName = Date.now() + coverPicture.name;
      data.append("name", fileName);
      data.append("file", coverPicture);

      try {
        const uploadRes = await axios.post("/api/upload?type=cover", data, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
        coverPictureUrl = uploadRes.data.filePath;
      } catch (err) {
        console.error("Error uploading cover picture:", err);
      }
    }

    const updatedSettings = {
      userId: currentUser._id,
      backgroundColor: themeColors[theme], // Save the hex color
      font,
      coverPicture: coverPictureUrl,
      desc,
    };

    try {
      const response = await axios.put(
        `/api/users/${currentUser._id}/settings`,
        updatedSettings
      );
      console.log("Settings updated successfully:", response.data);

      dispatch(
        UpdateSuccess({
          ...currentUser,
          backgroundColor: themeColors[theme],
          font,
          coverPicture: coverPictureUrl,
          desc,
        })
      );
      alert("設定が更新されました！");
    } catch (err) {
      console.error("Error updating settings:", err);
      const errorMsg = err.response?.data || "設定の更新に失敗しました。";
      alert(typeof errorMsg === "string" ? errorMsg : "設定の更新に失敗しました。");
    }
  };

  return (
    <>
      <Topbar />
      <div className="settings">
        <Sidebar />
        <div className="settingsWrapper">
          <div className="settingsTitle">
            <span className="settingsUpdateTitle">Setting</span>
          </div>
          <form className="settingsForm" onSubmit={handleSubmit}>
            <div className="settingsOption">
              <label>自己紹介文 (最大50文字):</label>
              <input
                type="text"
                maxLength="50"
                className="settingsDescInput"
                placeholder="一言コメントを入力..."
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div className="settingsOption">
              <label>テーマ:</label>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="light">White</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="settingsOption">
              <label>フォント:</label>
              <select value={font} onChange={(e) => setFont(e.target.value)}>
                <option value="Arial">Arial</option>
                <option value="Verdana">Verdana</option>
                <option value="Georgia">Georgia</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
                <option value="serif">Serif</option>
                <option value="sans-serif">Sans-serif</option>
                <option value="monospace">Monospace</option>
              </select>
            </div>
            <div className="settingsOption">
              <label>プロフィール背景画像:</label>
              <div className="settingsCoverContainer">
                <img
                  className="settingsCoverPreview"
                  src={
                    coverPicturePreview
                      ? (coverPicturePreview.startsWith("http") || coverPicturePreview.startsWith("blob"))
                        ? coverPicturePreview
                        : PUBLIC_FOLDER + (coverPicturePreview.startsWith("/assets/") ? coverPicturePreview.replace("/assets/", "") : coverPicturePreview)
                      : PUBLIC_FOLDER + "post/3.jpeg"
                  }
                  alt="Cover Preview"
                />
                <label htmlFor="file" className="settingsCoverUpload">
                  画像を変更
                </label>
              </div>
              <input
                type="file"
                id="file"
                accept=".png,.jpeg,.jpg"
                onChange={handleFileChange}
              />
            </div>
            <button className="settingsSubmitButton" type="submit">
              更新
            </button>
          </form>

          <hr className="settingsHr" />

          <div className="settingsLogout">
            <h3 className="settingsLogoutTitle">アカウント詳細</h3>

            <div className="settingsFollowButtons">
              <button
                type="button"
                className={`settingsToggleButton ${showFollowings ? 'active' : ''}`}
                onClick={() => setShowFollowings(!showFollowings)}
              >
                フォロー中 ({followings.length})
              </button>
              <button
                type="button"
                className={`settingsToggleButton ${showFollowers ? 'active' : ''}`}
                onClick={() => setShowFollowers(!showFollowers)}
              >
                フォロワー ({followers.length})
              </button>
            </div>

            <div className="settingsFollowSection">
              {showFollowings && (
                <div className="settingsFollowListContainer">
                  <h4>フォロー中</h4>
                  <div className="settingsFollowList">
                    {followings.length === 0 ? (
                      <p className="noFollows">フォロー中のユーザーはいません。</p>
                    ) : (
                      followings.map((f) => (
                        <a href={`/profile/${f.username}`} key={f._id} className="settingsFollowItem">
                          <img
                            src={f.profilePicture ? f.profilePicture : PUBLIC_FOLDER + "person/noAvatar.png"}
                            alt=""
                            className="settingsFollowImg"
                          />
                          <span className="settingsFollowName">{f.username}</span>
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )}

              {showFollowers && (
                <div className="settingsFollowListContainer">
                  <h4>フォロワー</h4>
                  <div className="settingsFollowList">
                    {followers.length === 0 ? (
                      <p className="noFollows">フォロワーはいません。</p>
                    ) : (
                      followers.map((f) => (
                        <a href={`/profile/${f.username}`} key={f._id} className="settingsFollowItem">
                          <img
                            src={f.profilePicture ? f.profilePicture : PUBLIC_FOLDER + "person/noAvatar.png"}
                            alt=""
                            className="settingsFollowImg"
                          />
                          <span className="settingsFollowName">{f.username}</span>
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button className="settingsLogoutButton" onClick={async () => {
              try {
                await axios.get("/api/auth/logout");
                localStorage.removeItem("token");
                delete axios.defaults.headers.common["Authorization"];
                if (dispatch) {
                  dispatch({ type: "LOGOUT" });
                }
                window.location.href = "/login";
              } catch (err) {
                console.error(err);
              }
            }}>
              ログアウト
            </button>
          </div>
        </div>
      </div>
      <Bottombar />
    </>
  );
}

