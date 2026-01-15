import React, { useContext, useRef, useState } from 'react';
import './share.css'
import { Analytics, EmojiEmotions, GifBox, Image, Cancel } from '@mui/icons-material'
import { AuthContext } from '../../state/AuthContext';
import axios from 'axios';
import imageCompression from 'browser-image-compression';

export default function Share() {
    const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";
    const { user } = useContext(AuthContext);
    const desc = useRef();
    const [file, setFile] = useState(null);

    const handleSubmit = async (e) => {
        //投稿のAPI
        e.preventDefault();
        const newPost = {
            userId: user._id,
            desc: desc.current.value,
        };
        if (file) {
            const data = new FormData();
            const fileName = Date.now() + file.name;
            data.append("name", fileName);
            data.append("file", file);
            try {
                const res = await axios.post("/api/upload?type=post", data);
                // Assign to correct field based on mime type
                if (file.type.startsWith("video/")) {
                    newPost.video = res.data.filePath;
                } else if (file.type.startsWith("image/")) {
                    newPost.img = res.data.filePath;
                } else {
                    newPost.file = res.data.filePath;
                    // Store filename potentially in desc or separate field if needed, currently just URL
                }
            } catch (err) {
                console.error("Upload failed", err);
                alert("画像のアップロードに失敗しました");
                return;
            }
        }
        try {
            await axios.post('/api/posts', newPost);
            window.location.reload();
        } catch (err) {
            console.error("Post failed", err);
            alert("投稿に失敗しました");
        }
    }

    return (
        <>
            {user && (
                <div className='share'>
                    <div className="shareWrapper">
                        <div className="shareTop">
                            <img
                                src={
                                    user.profilePicture
                                        ? user.profilePicture.startsWith("http")
                                            ? user.profilePicture
                                            : PUBLIC_FOLDER + (user.profilePicture.startsWith("/assets/") ? user.profilePicture.replace("/assets/", "") : user.profilePicture)
                                        : PUBLIC_FOLDER + "person/noAvatar.png"
                                }
                                alt=""
                                className="shareProfileImg"
                            />
                            <input
                                type="text"
                                placeholder="今日を振り返ろう"
                                className="shareInput"
                                ref={desc}
                            />
                        </div>
                        <hr className="shareHr" />
                        {file && (
                            <div className="shareImgContainer">
                                {file.type.startsWith("image/") ? (
                                    <img src={URL.createObjectURL(file)} alt="" className='shareImg' />
                                ) : file.type.startsWith("video/") ? (
                                    <video src={URL.createObjectURL(file)} controls playsInline className='shareImg' />
                                ) : (
                                    <div className="shareFilePreview">
                                        <span role="img" aria-label="file">📄</span> {file.name}
                                    </div>
                                )}
                                <Cancel className='shareCancelImg' onClick={() => setFile(null)} />
                            </div>
                        )}
                        <form className="shareOptions" onSubmit={(e) => handleSubmit(e)}>
                            <div className="shareOptionDetail">
                                <label className="shareOption"
                                    htmlFor="file"
                                >
                                    <Image htmlColor='royalblue' />
                                    <span className="onMouseIcon">
                                        Media
                                    </span>
                                    <input type="file"
                                        id="file"
                                        accept=".png, .jpeg, .jpg, .gif, .mp4, .mov, .avi, .webm, .pdf, .doc, .docx, .zip, .txt"
                                        style={{ display: "none" }}
                                        onChange={async (e) => {
                                            const originalFile = e.target.files[0];
                                            if (!originalFile) return;

                                            // Check for 100MB limit
                                            if (originalFile.size > 100 * 1024 * 1024) {
                                                alert("ファイルサイズは100MB以下にしてください。");
                                                e.target.value = ""; // Clear the input
                                                return;
                                            }

                                            setFile(originalFile);

                                            // Only compress images
                                            if (originalFile.type.startsWith("image/")) {
                                                const options = {
                                                    maxSizeMB: 0.5,
                                                    maxWidthOrHeight: 1920,
                                                    useWebWorker: true,
                                                };
                                                try {
                                                    const compressedFile = await imageCompression(originalFile, options);
                                                    const renamedFile = new File([compressedFile], originalFile.name, { type: compressedFile.type });
                                                    setFile(renamedFile);
                                                } catch (error) {
                                                    console.error("Compression failed:", error);
                                                }
                                            }
                                        }}
                                        name="file"
                                    />
                                </label>
                                <div className="shareOption">
                                    <GifBox className='shareIcon' htmlColor='royalblue' />
                                    <span className="onMouseIcon">
                                        GIF
                                    </span>
                                </div>
                                <div className="shareOption">
                                    <EmojiEmotions className='shareIcon' htmlColor='royalblue' />
                                    <span className="onMouseIcon">
                                        Emoji
                                    </span>
                                </div>
                                <div className="shareOption">
                                    <Analytics className='shareIcon' htmlColor='royalblue' />
                                    <span className="onMouseIcon">
                                        Poll
                                    </span>
                                </div>
                            </div>
                            <button className="shareButton" type="submit">シェアする</button>
                        </form>
                    </div>
                </div>
            )}
        </>
    )
}
