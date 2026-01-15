import React, { useState, useEffect, useContext } from 'react';
import { Chat, Notifications, Search } from '@mui/icons-material';
import './topbar.css';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../state/AuthContext';
import { SocketContext } from '../../state/SocketContext';

export default function Topbar({ onSearch, initialValue = '' }) {
    const { user } = useContext(AuthContext);
    const { unreadMessages, unreadNotifications, resetUnreadNotifications } = useContext(SocketContext);
    const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";

    const [query, setQuery] = useState('');
    const navigate = useNavigate();

    // initialValue があればセット（検索ページから戻ってきたとき等）
    useEffect(() => {
        setQuery(initialValue || '');
    }, [initialValue]);

    const handleSubmit = (e) => {
        if (e) e.preventDefault(); // Click event might not need preventDefault but form submit does
        const q = (query || '').toString().trim();
        if (!q) return;
        if (typeof onSearch === 'function') onSearch(q);
        navigate(`/search?q=${encodeURIComponent(q)}`);
    };

    return (
        <div className='topbarContainer'>
            <div className='topbarLeft'>
                <Link to='/' style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className='logo'>
                        Y
                    </span>
                    <span className='sublogo'>
                        HakuaSNS
                    </span>
                </Link>
            </div>
            <div className="topbarCenter">
                {/* エンターで送信 */}
                <form className="searchbar" onSubmit={handleSubmit}>
                    <Search className='searchIcon' onClick={handleSubmit} style={{ cursor: 'pointer' }} />
                    <input
                        type="text"
                        className='searchInput'
                        placeholder="興味のあるものを探そう"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </form>
            </div>
            {user && (
                <div className="topbarRight">
                    <div className="topbarIconItem">
                        <Link to="/messenger" style={{ color: 'inherit' }}>
                            <div className="topbarIconItem1">
                                <Chat />
                                {unreadMessages > 0 && <span className="topbarIconBadge">{unreadMessages}</span>}
                            </div>
                        </Link>
                        <Link to="/notifications" style={{ color: 'inherit' }}>
                            <div className="topbarIconItem1" style={{ cursor: 'pointer' }}>
                                <Notifications />
                                {unreadNotifications > 0 && <span className="topbarIconBadge">{unreadNotifications}</span>}
                            </div>
                        </Link>
                        <Link to={`/profile/${user.username}`}>
                            <img
                                src={
                                    user.profilePicture
                                        ? user.profilePicture.startsWith("http")
                                            ? user.profilePicture
                                            : PUBLIC_FOLDER + (user.profilePicture.startsWith("/assets/") ? user.profilePicture.replace("/assets/", "") : user.profilePicture)
                                        : PUBLIC_FOLDER + "person/noAvatar.png"
                                }
                                alt=""
                                className="topbarImg"
                            />
                        </Link>
                    </div>
                </div>
            )}

        </div>
    )

}