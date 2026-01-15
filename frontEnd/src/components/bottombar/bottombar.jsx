import { Home, Notifications, MessageRounded, Bookmark, Person, Settings, MoreVert } from '@mui/icons-material'
import React, { useContext, useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthContext } from '../../state/AuthContext';
import './bottombar.css'

export default function Bottombar() {
    const { user } = useContext(AuthContext);
    //   const [showMenu, setShowMenu] = useState(false);
    //   const navigate = useNavigate();

    //   const menuRef = useRef(null);




    return (
        <div className='bottombarContainer'>
            <div className="bottombarList">
                <li className="BottombarListItem">
                    <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
                        <Home className='BottombarIcon' />
                    </Link>
                </li>
                <li className="BottombarListItem">
                    <Link to="/notifications" style={{ textDecoration: "none", color: "inherit" }}>
                        <Notifications className='BottombarIcon' />
                    </Link>
                </li>
                <li className="BottombarListItem">
                    <Link to="/messenger" style={{ textDecoration: "none", color: "inherit" }}>
                        <MessageRounded className='BottombarIcon' />
                    </Link>
                </li>
                {user && (
                    <li className="BottombarListItem">
                        <Link to={`/profile/${user.username}`} style={{ textDecoration: "none", color: "inherit" }}>
                            <Person className='BottombarIcon' />
                        </Link>
                    </li>
                )}
                <li className="BottombarListItem">

                    <Link to="/setting" style={{ textDecoration: "none", color: "inherit" }}>
                        <Settings className='BottombarIcon' />
                    </Link>

                </li>
            </div>
        </div>

    )
}
