*** Settings ***
Library    String
Library    Collections

*** Variables ***
${TableVariable}    ABC

*** Test Cases ***
A Simple Test Case
    ${random_str}=    Generate Random String    10
    Test Keyword    ${random_str}    Value    CCC

*** Keywords ***
Test Keyword
    [Arguments]    ${aaa}    ${bbb}    ${ccc}
    @{list}=    Create List
    Append To List    ${list}    ${aaa}    ${bbb}    ${ccc}    ${TableVariable}
    Log To Console    Exit
