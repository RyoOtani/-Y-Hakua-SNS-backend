import React, { useContext, useEffect, useState } from "react";
import "./setting.css";
import Sidebar from "../../components/sidebar/sidebar";
import Topbar from "../../components/Topbar/TopbarMain";
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
  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER;

  // State for theme name ('light' or 'dark')
  const [theme, setTheme] = useState(
    currentUser.backgroundColor === themeColors.dark ? "dark" : "light"
  );
  const [font, setFont] = useState(currentUser.font || "Arial");
  const [coverPicture, setCoverPicture] = useState(null);
  const [coverPicturePreview, setCoverPicturePreview] = useState(
    currentUser.coverPicture
  );

  // The global theme application is now handled in App.js
  // No need for a useEffect here anymore.

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setCoverPicture(file);
      setCoverPicturePreview(URL.createObjectURL(file));
    }
  };

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
        </div>
      </div>
      <Bottombar />
    </>
  );
}

