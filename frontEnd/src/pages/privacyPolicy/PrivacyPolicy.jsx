import React, { useContext, useState } from "react";
import "./privacyPolicy.css";
import { AuthContext } from "../../state/AuthContext";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function PrivacyPolicy() {
    const { user, dispatch } = useContext(AuthContext);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleAgree = async () => {
        setLoading(true);
        try {
            const res = await axios.put(`/api/users/${user._id}/agree-privacy`);
            dispatch({ type: "LOGIN_SUCCESS", payload: res.data });
            navigate("/");
        } catch (err) {
            console.error("Agreement error:", err);
            alert("エラーが発生しました。もう一度お試しください。");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="privacyPolicy">
            <div className="privacyPolicyWrapper">
                <h1 className="privacyPolicyTitle">利用規約およびプライバシーポリシーへの同意</h1>

                <div className="policySections">
                    <div className="policySection">
                        <h2 className="sectionTitle">利用規約</h2>
                        <div className="privacyPolicyContent">
                            <p>当サービスを利用するにあたり、以下の利用規約にご同意いただく必要があります。</p>
                            <h3>1. 利用条件</h3>
                            <p>ユーザーは、本規約に従って本サービスを利用するものとします。不正なアクセスや情報の改ざん、他者の権利を侵害する行為を禁止します。</p>
                            <h3>2. アカウント管理</h3>
                            <p>ユーザーは自身のログイン情報を適切に管理する責任を負います。アカウントの第三者への貸与や譲渡は禁止されています。</p>
                            <h3>3. 禁止事項</h3>
                            <p>(1).誹謗中傷、公序良俗に反する投稿、スパム行為等は固く禁じられています。 </p>
                            <p>(2).個人情報の漏洩や第三者への提供は禁止されています。</p>
                            <p>(3).当サイト運営より、いじめと判断された場合は学校側に通報することがあります。</p>
                            <p>(4).事件性のある投稿、またはそれを助長する行為が確認する場合は該当ユーザーに向けて該当される投稿への削除要請をいたします。これに従わなかった場合、アカウントの停止、またはアカウント情報の削除、そして学校への報告をいたします。</p>
                            <p>(6).違反した場合はアカウントを停止することがあります。</p>

                            <h3>4. 免責事項</h3>
                            <p>当サービスは、システムの中断やデータの損失等により生じた損害について、一切の責任を負わないものとします。</p>
                            <p>当サービスにおける投稿、いいね等のリアクションにおけるトラブルに対する責任は負いかねますのでご了承ください。</p>
                            <h3>5. その他の確認事項</h3>
                            <p>当サイトはあくまで研究開発を目的としたものです。一定期間後に開発、アップデート、またサイトの運営を停止する可能性がありますのでご留意ください。</p>
                        </div>
                    </div>

                    <div className="policySection">
                        <h2 className="sectionTitle">プライバシーポリシー</h2>
                        <div className="privacyPolicyContent">
                            <p>
                                当サイトは次世代SNS「Y」の開発班（以下より「運営」とします）により運営されております。本ウェブサイト上におけるサービスにおける、ユーザーの個人情報の取り扱いについて、以下の通りプライバシーポリシーを定めます。
                            </p>
                            <h3>1. 収集する情報</h3>
                            <p>
                                次世代SNS「Y」ではGoogle accountによる認証を通して、ユーザー名、メールアドレス、プロフィール画像を取得します。また、サービス内での投稿やメッセージ、フォロー関係などの情報を収集します。
                            </p>
                            <h3>2. 利用目的</h3>
                            <p>
                                収集した情報をサービス提供、ユーザー間でのコミュニケーションの促進、サービスの改良及び「次世代SNS『Y』」の全サービス(以下、当サービス)の不正利用の防止の為に利用します。
                            </p>
                            <h3>3. 第三者への情報取引につきまして</h3>
                            <p>
                                法令に準するところによらない限り、当サービスに提供した個人情報はユーザー自身の同意なく提供することはありません。
                            </p>
                            <p>
                                (1)ユーザーへの通知については運営班から直接同意確認の通知をお送りいたします。
                            </p>
                            <p>
                                (2)停止請求にいたしましてはお問い合わせフォームの送信をお願いします。
                            </p>
                            <p>
                                (3)当班の利用目的の達成に必要な範囲においてサービスの委託を行う場合につきましてはこの限りではありません。
                            </p>
                            <p>
                                (4)ユーザーが起こした問題に対しての開示請求を公的機関から受けた場合につきましては上記の限りではありません、ご注意ください。
                                また、禁止事項に記載された行為について確認された場合についても上記の限りではありません。
                            </p>
                            <h3>4. 情報セキュリティにつきまして</h3>
                            <p>
                                本サービスは、個人情報の取扱いに関する個人情報保護法の遵守を徹底します。
                            </p>
                            <p>
                                Cookie（クッキー）について 当サービスでは、Google認証のプロセス維持のために最低限必要なCookieを使用することがあります。
                                これらはユーザー個別の追跡や広告目的には使用されず、サービスの正常な動作のためにのみ利用されます。また、認証情報の維持にはブラウザのlocalStorageを利用しています。
                            </p>
                            <p>
                                当サイトはSSL暗号化技術を用いて、個人情報の保護を徹底しています。  またデータに関して当班内でも一部の人間のみがデータを扱い、当人が個人データを外部に流出させることはありません。
                            </p>
                            <h3>5. 免責事項について</h3>
                            <p>
                                当サービスにおける投稿、いいね等のリアクションにおけるトラブルに対する責任は負いかねますのでご了承ください。
                            </p>
                            <h3>6. プライバシーポリシーの変更について</h3>
                            <p>
                                (1). 本ポリシーの内容は、法令その他本ポリシーに別段定めのある事項を除いて、ユーザーに通知することなく変更できるものとします。
                            </p>
                            <p>
                                (2). 当班が定める場合を除いて、変更後のプライバシーポリシーは、本ウェブサイトに掲載した時から効力を生じるものとします。
                            </p>
                            <h3>7. その他・お問い合わせについて</h3>
                            <p>
                                当サイトは、Google Classroomの利用の活発化を目的としていますが、当サイトからユーザーの所属するGoogle Classroomの情報を取得することはございませんので安心してご使用ください。
                            </p>
                            <p>
                                何かご不明な点やご意見ございましたら、お気軽にお問い合わせください。
                            </p>
                            <a href="https://docs.google.com/forms/d/e/1FAIpQLSdVUZFd_moCAJ8R2BSrnMPw-jGrbM5EckvwCyKr1n2_pH8SKg/viewform?usp=header" target="_blank" rel="noopener noreferrer">お問い合わせフォームはこちら</a>
                        </div>
                    </div>
                </div>

                <button
                    className="agreeButton"
                    onClick={handleAgree}
                    disabled={loading}
                >
                    {loading ? "処理中..." : "すべてに同意して進む"}
                </button>
            </div>
        </div>
    );
}
