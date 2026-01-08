import React, { useContext, useRef, useState } from 'react';
import './share.css'
import { Analytics, EmojiEmotions, GifBox, Image, Cancel } from '@mui/icons-material'
import { AuthContext } from '../../state/AuthContext';
import axios from 'axios';
import imageCompression from 'browser-image-compression';

export default function Share() {
    const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER;
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
                newPost.img = res.data.filePath;
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
                                <img src={URL.createObjectURL(file)} alt="" className='shareImg' />
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
                                        accept=".png, .jpeg, .jpg"
                                        style={{ display: "none" }}
                                        onChange={async (e) => {
                                            const originalFile = e.target.files[0];
                                            if (!originalFile) return;

                                            // 1. 直ちにプレビューを表示（元ファイルを使用）
                                            setFile(originalFile);

                                            // 2. バックグラウンドで圧縮を試行
                                            const options = {
                                                maxSizeMB: 0.5, // 500KB
                                                maxWidthOrHeight: 1920,
                                                useWebWorker: true,
                                            };

                                            try {
                                                const compressedFile = await imageCompression(originalFile, options);
                                                // 圧縮成功ならファイルを差し替え
                                                const renamedFile = new File([compressedFile], originalFile.name, { type: compressedFile.type });
                                                setFile(renamedFile);
                                                console.log(`Compression successful: ${originalFile.size / 1024 / 1024}MB -> ${renamedFile.size / 1024 / 1024}MB`);
                                            } catch (error) {
                                                console.error("Compression failed or skipped:", error);
                                                // 失敗しても元ファイルがセットされているので問題なし
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
