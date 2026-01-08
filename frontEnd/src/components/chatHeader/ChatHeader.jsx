import React, { useEffect, useState } from "react";
import axios from "axios";

export default function ChatHeader({ conversation, currentUser, PF }) {
    const [partner, setPartner] = useState(null);

    useEffect(() => {
        const friendId = conversation.members.find((m) => m !== currentUser._id);
        const getPartner = async () => {
            try {
                const res = await axios.get("/api/users?userId=" + friendId);
                setPartner(res.data);
            } catch (err) {
                console.log(err);
            }
        };
        getPartner();
    }, [conversation, currentUser]);

    if (!partner) return null;

    return (
        <div className="chatHeaderInfo">
            <img
                className="chatHeaderImg"
                src={
                    partner.profilePicture
                        ? partner.profilePicture.startsWith("http")
                            ? partner.profilePicture
                            : PF + (partner.profilePicture.startsWith("/assets/") ? partner.profilePicture.replace("/assets/", "") : partner.profilePicture)
                        : PF + "person/noAvatar.png"
                }
                alt=""
            />
            <div className="chatHeaderTexts">
                <span className="chatHeaderName">{partner.name || partner.username}</span>
                <span className="chatHeaderStatus">Online</span>
            </div>
        </div>
    );
}
