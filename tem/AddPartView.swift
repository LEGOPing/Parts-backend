//
//  AddPartView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/17.
//

import SwiftUI
import CoreData
import Foundation
import Combine
import UIKit

struct AddPartView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    var box: NSManagedObject
    
    // 使用AddPartState管理状态
    @StateObject private var addPartState = AddPartState()
    
    // 焦点状态管理
    @FocusState private var isWeightInputFocused: Bool
    @FocusState private var isPartNumberInputFocused: Bool
    
    // 标题栏视图
    private var headerView: some View {
        HStack {
            Text("添加零件")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.primary)
            Spacer()
            HStack(spacing: 15) {
                Button(action: {
                    // 关闭零件型号联想器
                    addPartState.showNumberSuggestions = false
                    currentState = .partManagement(box)
                }) {
                    Text("取消")
                        .font(.system(size: 14))
                        .foregroundColor(.blue)
                }
                Button(action: {
                    // 关闭零件型号联想器
                    addPartState.showNumberSuggestions = false
                    savePart()
                }) {
                    Text("保存")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 6)
                        .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                        .cornerRadius(4)
                }
            }
        }
        .padding(15)
        .background(Color.white)
        .overlay(GeometryReader { geometry in
            Color.gray.opacity(0.2)
                .frame(height: 1)
                .position(x: geometry.size.width / 2, y: geometry.size.height - 0.5)
        })
    }
    
    // 零件型号部分视图
    private var partNumberSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 添加GeometryReader来获取容器位置
            GeometryReader { geometry in
                Color.clear
                    .onAppear {
                        addPartState.modelGroupFrame = geometry.frame(in: .global)
                        print("型号组容器全局坐标: \(addPartState.modelGroupFrame)")
                    }
                    .onChange(of: geometry.frame(in: .global)) { oldValue, newValue in
                        addPartState.modelGroupFrame = newValue
                        print("型号组容器全局坐标已更新: \(addPartState.modelGroupFrame)")
                    }
            }
            .frame(width: 0, height: 0) // 不影响布局
            
            // 零件型号、联想名称、选择零件按钮、零件状态 - 同一行
            HStack(alignment: .center, spacing: 10) {
                // 零件型号标签
                Text("零件型号：")
                    .font(.system(size: 14))
                    .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    .fixedSize(horizontal: true, vertical: true)
                
                // 零件型号输入框
                TextField("请输入零件型号", text: $addPartState.partNumber)
                    .font(.system(size: 14))
                    .padding(6)
                    .border(Color.gray.opacity(0.3))
                    .cornerRadius(4)
                    .frame(width: 150) // 固定宽度
                    .frame(height: 32) // 统一高度
                    .focused($isPartNumberInputFocused)
                    .background(
                        GeometryReader { geometry in
                            Color.clear
                                .onAppear {
                                    // 获取输入框相对于全局的坐标
                                    addPartState.partNumberInputFrame = geometry.frame(in: .global)
                                    print("输入框全局坐标: \(addPartState.partNumberInputFrame)")
                                }
                                .onChange(of: geometry.frame(in: .global)) { oldValue, newValue in
                                    addPartState.partNumberInputFrame = newValue
                                    print("输入框全局坐标已更新: \(addPartState.partNumberInputFrame)")
                                }
                        }
                    )
                    .onChange(of: addPartState.partNumber) { oldValue, newValue in
                        print("输入框内容已更改: \(newValue)")
                        // 清除之前的定时器
                        addPartState.tempPartTimer?.invalidate()
                        
                        // 输入为空时清除建议
                        if newValue.isEmpty {
                            print("输入为空，清除建议")
                            addPartState.numberSuggestions = []
                            addPartState.showNumberSuggestions = false
                            addPartState.partName = ""
                            addPartState.tempPartObject = nil
                            addPartState.tempPartTimer?.invalidate()
                        } else {
                            // 限制搜索文本长度，避免过长的搜索
                            let trimmedInput = newValue.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                            if trimmedInput.count > 10 {
                                print("搜索文本过长，不触发查询")
                                addPartState.numberSuggestions = []
                                addPartState.showNumberSuggestions = false
                                return
                            }
                            
                            // 设置新的定时器，延迟1秒后触发查询
                            addPartState.tempPartTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
                                // 检查输入是否已被修改
                                let currentInput = addPartState.partNumber
                                print("定时器触发，当前输入: \(currentInput)")
                                
                                if !currentInput.isEmpty {
                                    // 再次检查搜索文本长度
                                    let currentTrimmedInput = currentInput.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                                    if currentTrimmedInput.count > 10 {
                                        print("搜索文本过长，不触发查询")
                                        return
                                    }
                                    
                                    // 获取零件名称、联想结果和临时零件对象
                                    self.loadPartData(for: currentTrimmedInput, colorInput: self.addPartState.colorInput, quantity: self.addPartState.quantity, showSuggestions: true)
                                }
                            }
                        }
                    }
                    .onTapGesture {
                        // 点击输入框时，显示联想器（如果有建议）
                        if !addPartState.partNumber.isEmpty && !addPartState.numberSuggestions.isEmpty {
                            addPartState.showNumberSuggestions = true
                        }
                    }
                
                // 联想的名称（可选）
                if !addPartState.partName.isEmpty {
                    Text(addPartState.partName)
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                        .lineLimit(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                
                // 添加Spacer()将选择零件按钮和零件状态推到右侧
                Spacer()
                
                // 选择零件按钮
                Button(action: {
                    // 关闭零件型号联想器
                    addPartState.showNumberSuggestions = false
                    addPartState.showPartSelector = true
                }) {
                    Text("选择零件")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                        .cornerRadius(4)
                }
                
                // 零件状态
                HStack(spacing: 5) {
                    Text("状态：")
                        .font(.system(size: 12))
                        .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    Button(action: {
                        addPartState.isNew = true
                    }) {
                        Text("新品")
                            .font(.system(size: 12))
                            .foregroundColor(addPartState.isNew ? .white : .primary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(addPartState.isNew ? Color(red: 0x27/255, green: 0xae/255, blue: 0x60/255) : Color.gray.opacity(0.2))
                            .cornerRadius(4)
                    }
                    Button(action: {
                        addPartState.isNew = false
                    }) {
                        Text("旧品")
                            .font(.system(size: 12))
                            .foregroundColor(!addPartState.isNew ? .white : .primary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(!addPartState.isNew ? Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255) : Color.gray.opacity(0.2))
                            .cornerRadius(4)
                    }
                }
            }
        }
        .padding(.horizontal, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    // 零件名称和颜色部分视图
    private var partNameAndColorSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 第一行：零件名称（带联想功能）
            PartNameSuggestionView(
                partNameInput: $addPartState.partNameInput,
                showNameSuggestions: $addPartState.showNameSuggestions,
                nameSuggestions: $addPartState.nameSuggestions,
                currentWordIndex: $addPartState.currentWordIndex,
                partName: $addPartState.partName,
                onPartNameChange: { newPartName in
                    // 零件名称变化时的回调
                    print("零件名称已更新: \(newPartName)")
                },
                onPartNumberFound: { partNumber in
                    // 匹配到零件型号时的回调
                    print("匹配到零件型号: \(partNumber)")
                    addPartState.partNumber = partNumber
                    // 清除之前的定时器，添加输入防抖
                    addPartState.tempPartTimer?.invalidate()
                    addPartState.tempPartTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { _ in
                        // 异步创建临时零件对象，不显示联想结果
                        loadPartData(for: partNumber, colorInput: addPartState.colorInput, quantity: addPartState.quantity, showSuggestions: false)
                    }
                }
            )
            
            // 第二行：零件颜色
            HStack(alignment: .center, spacing: 10) {
                Text("零件颜色：")
                    .font(.system(size: 14))
                    .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    .fixedSize(horizontal: true, vertical: true)
                TextField("请输入颜色ID或名称", text: $addPartState.colorInput)
                    .font(.system(size: 14))
                    .padding(6)
                    .border(Color.gray.opacity(0.3))
                    .cornerRadius(4)
                    .frame(maxWidth: .infinity)
                    .frame(height: 32) // 统一高度
                    .onChange(of: addPartState.colorInput) { oldValue, newValue in
                        print("颜色输入框内容已更改: \(newValue)")
                        // 关闭零件型号联想器
                        addPartState.showNumberSuggestions = false
                        // 清除之前的定时器
                        addPartState.tempPartTimer?.invalidate()
                        
                        // 输入为空时清除临时零件对象
                        if newValue.isEmpty {
                            print("颜色输入为空，清除临时零件对象")
                            addPartState.tempPartObject = nil
                            addPartState.tempPartTimer?.invalidate()
                        } else {
                            // 限制输入长度，避免过长的输入
                            let trimmedInput = newValue.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                            if trimmedInput.count > 10 {
                                print("颜色输入过长，不触发查询")
                                return
                            }
                            
                            // 立即获取颜色名称
                            if let colorId = Int32(trimmedInput) {
                                fetchColorName(from: colorId)
                            }
                            
                            // 设置新的定时器，延迟1秒后触发查询
                            addPartState.tempPartTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
                                // 检查输入是否已被修改
                                let currentInput = addPartState.colorInput
                                print("颜色输入定时器触发，当前输入: \(currentInput)")
                                
                                if !currentInput.isEmpty && !addPartState.partNumber.isEmpty {
                                    // 加载零件数据，不显示联想结果
                                    loadPartData(for: addPartState.partNumber, colorInput: currentInput, quantity: self.addPartState.quantity, showSuggestions: false)
                                }
                            }
                        }
                    }
                Button(action: {
                    if !addPartState.partNumber.isEmpty {
                        addPartState.showColorPicker = true
                    } else {
                        addPartState.errorMessage = "请先输入零件型号"
                    }
                }) {
                    Text("选择颜色")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                        .cornerRadius(4)
                }
            }
        }
        .padding(.horizontal, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    // 零件数量和重量计算部分视图
    private var quantityAndWeightSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                // 左列：零件数量
                VStack(alignment: .leading, spacing: 6) {
                    Text("零件数量：")
                        .font(.system(size: 14))
                        .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    TextField("请输入零件数量", text: $addPartState.quantity)
                        .font(.system(size: 14))
                        .padding(6)
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(4)
                        .keyboardType(.numberPad)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32) // 统一高度
                        .onChange(of: addPartState.quantity) { oldValue, newValue in
                            print("数量输入框内容已更改: \(newValue)")
                            // 清除之前的定时器
                            addPartState.tempPartTimer?.invalidate()
                            
                            // 设置新的定时器，延迟1秒后触发查询
                            addPartState.tempPartTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
                                // 检查输入是否已被修改
                                let currentInput = addPartState.quantity
                                print("数量输入定时器触发，当前输入: \(currentInput)")
                                
                                if !currentInput.isEmpty && !addPartState.partNumber.isEmpty && !addPartState.colorInput.isEmpty {
                                    // 加载零件数据，不显示联想结果
                                    loadPartData(for: addPartState.partNumber, colorInput: addPartState.colorInput, quantity: currentInput, showSuggestions: false)
                                }
                            }
                        }
                }
                .frame(maxWidth: .infinity)
                
                // 中列：单个零件重量 + 获得重量按钮
                VStack(alignment: .leading, spacing: 6) {
                    Text("单个零件重量：")
                        .font(.system(size: 14))
                        .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    HStack(spacing: 6) {
                        TextField("克", text: $addPartState.manualWeightInput)
                            .font(.system(size: 14))
                            .padding(6)
                            .border(Color.gray.opacity(0.3))
                            .cornerRadius(4)
                            .keyboardType(.decimalPad)
                            .frame(maxWidth: .infinity)
                            .frame(height: 32) // 统一高度
                            .disabled(!addPartState.allowManualWeightInput) // 默认禁止手动输入
                            .onLongPressGesture(minimumDuration: 1.0) {
                                print("长按重量输入框，允许手动输入")
                                // 长按输入框允许手动输入单个零件重量
                                addPartState.allowManualWeightInput = true
                                // 自动聚焦到输入框
                                isWeightInputFocused = true
                            }
                            .focused($isWeightInputFocused)
                            .onChange(of: isWeightInputFocused) {
                                oldValue, newValue in
                                if !newValue && addPartState.allowManualWeightInput {
                                    // 当输入框失去焦点时，恢复禁止手动输入
                                    print("输入框失去焦点，恢复禁止手动输入")
                                    addPartState.allowManualWeightInput = false
                                }
                            }
                            .onSubmit {
                                // 输入完成后恢复禁止手动输入
                                print("输入完成，恢复禁止手动输入")
                                addPartState.allowManualWeightInput = false
                                isWeightInputFocused = false
                            }
                        
                        Button(action: {
                            getPartWeight()
                        }) {
                            Text("获得重量")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(Color(red: 0x34/255, green: 0x98/255, blue: 0xdb/255))
                                .cornerRadius(4)
                        }
                        .frame(height: 32) // 统一高度
                    }
                }
                .frame(maxWidth: .infinity)
                
                // 右列：零件总重量 + 计算数量按钮
                VStack(alignment: .leading, spacing: 6) {
                    Text("零件总重量：")
                        .font(.system(size: 14))
                        .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    HStack(spacing: 6) {
                        TextField("克", text: $addPartState.weight)
                            .font(.system(size: 14))
                            .padding(6)
                            .border(Color.gray.opacity(0.3))
                            .cornerRadius(4)
                            .keyboardType(.decimalPad)
                            .frame(maxWidth: .infinity)
                            .frame(height: 32) // 统一高度
                        
                        Button(action: {
                            calculateQuantity()
                        }) {
                            Text("计算数量")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(Color(red: 0x27/255, green: 0xae/255, blue: 0x60/255))
                                .cornerRadius(4)
                        }
                        .frame(height: 32) // 统一高度
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 5) // 紧凑设计
    }
    
    // 零件卡片视图
    private var partCardView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("零件信息")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
            
            // 零件卡片
            VStack(spacing: 15) {
                // 上部分：图片和零件信息
                HStack(spacing: 15) {
                    // 左边：临时零件图片
                    if !addPartState.partNumber.isEmpty {
                        if let colorId = Int32(addPartState.colorInput) {
                            PartImageLoader(
                                partNum: addPartState.partNumber,
                                colorId: colorId,
                                onImgUrlUpdated: { url in
                                    addPartState.partImageUrl = url
                                }
                            )
                            .frame(width: 150, height: 150)
                            .cornerRadius(4)
                        } else {
                            Color.gray.opacity(0.2)
                                .frame(width: 150, height: 150)
                                .cornerRadius(4)
                                .overlay(
                                    Text("请输入颜色ID")
                                        .font(.system(size: 12))
                                        .foregroundColor(.gray)
                                        .multilineTextAlignment(.center)
                                )
                        }
                    } else {
                        Color.gray.opacity(0.2)
                            .frame(width: 150, height: 150)
                            .cornerRadius(4)
                            .overlay(
                                Text("请输入零件型号")
                                    .font(.system(size: 14))
                                    .foregroundColor(.gray)
                                    .multilineTextAlignment(.center)
                            )
                    }
                    
                    // 右边：零件信息
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("型号:")
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                            Text(!addPartState.partNumber.isEmpty ? addPartState.partNumber : "未设置")
                                .font(.system(size: 14))
                                .foregroundColor(.primary)
                        }
                        
                        HStack {
                            Text("名称:")
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                            Text(!addPartState.partName.isEmpty ? addPartState.partName : "未设置")
                                .font(.system(size: 14))
                                .foregroundColor(.primary)
                        }
                        
                        HStack {
                            Text("颜色ID:")
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                            Text(!addPartState.colorInput.isEmpty ? addPartState.colorInput : "未设置")
                                .font(.system(size: 14))
                                .foregroundColor(.primary)
                        }
                        
                        HStack {
                            Text("颜色名称:")
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                            Text(!addPartState.colorName.isEmpty ? addPartState.colorName : "未设置")
                                .font(.system(size: 14))
                                .foregroundColor(.primary)
                        }
                        
                        HStack {
                            Text("数量:")
                                .font(.system(size: 14))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                            Text(!addPartState.quantity.isEmpty ? addPartState.quantity : "未设置")
                                .font(.system(size: 14))
                                .foregroundColor(.primary)
                        }
                    }
                }
                
                // 下部：图片URL
                VStack(alignment: .leading, spacing: 5) {
                    Text("图片URL:")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    ScrollView(.horizontal, showsIndicators: true) {
                        if let imageUrl = addPartState.partImageUrl, !imageUrl.isEmpty {
                            Text(imageUrl)
                                .font(.system(size: 12))
                                .foregroundColor(.blue)
                                .padding(.vertical, 5)
                        } else {
                            Text("无")
                                .font(.system(size: 12))
                                .foregroundColor(.gray)
                                .padding(.vertical, 5)
                        }
                    }
                    .frame(height: 30)
                    .background(Color.gray.opacity(0.05))
                    .cornerRadius(4)
                }
            }
            .padding(15)
            .background(Color.white)
            .border(Color.gray.opacity(0.3))
            .cornerRadius(8)
            
            // 错误信息显示
            if let errorMessage = addPartState.errorMessage {
                Text(errorMessage)
                    .font(.system(size: 12))
                    .foregroundColor(.red)
                    .padding(10)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(4)
            }
        }
        .padding(.horizontal, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    // 零件型号联想建议弹窗
    private var partNumberSuggestionPopup: some View {
        if addPartState.showNumberSuggestions && !addPartState.numberSuggestions.isEmpty {
            return VStack(alignment: .leading, spacing: 2) { // 紧凑设计，减少间距
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) { // 紧凑设计，减少间距
                        ForEach(addPartState.numberSuggestions, id: \.self) { suggestion in
                            Button(action: {
                                addPartState.partNumber = suggestion.number
                                // 手动触发零件型号变化的处理
                                if !suggestion.number.isEmpty {
                                    fetchPartName(from: suggestion.number)
                                    // 清除之前的定时器，添加输入防抖
                                    addPartState.tempPartTimer?.invalidate()
                                    addPartState.tempPartTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { _ in
                                        // 异步创建临时零件对象，不显示联想结果
                                    loadPartData(for: suggestion.number, colorInput: self.addPartState.colorInput, quantity: self.addPartState.quantity, showSuggestions: false)
                                    }
                                } else {
                                    addPartState.partName = ""
                                    addPartState.tempPartObject = nil
                                    addPartState.tempPartTimer?.invalidate()
                                }
                                // 退出输入框的输入状态
                                isPartNumberInputFocused = false
                                // 关闭联想器
                                addPartState.showNumberSuggestions = false
                            }) {
                                HStack(alignment: .top, spacing: 8) { // 上对齐
                                    Text(suggestion.number)
                                        .font(.system(size: 14))
                                        .foregroundColor(.primary)
                                        .fixedSize(horizontal: true, vertical: true)
                                    Text(suggestion.name)
                                        .font(.system(size: 12))
                                        .foregroundColor(.gray)
                                        .lineLimit(2) // 允许显示两行
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(8) // 减少内边距，紧凑设计
                                .background(Color.white)
                                .border(Color.gray.opacity(0.2))
                            }
                        }
                    }
                }
            }
            .background(Color.white)
            .cornerRadius(4)
            .shadow(radius: 5)
            .frame(maxWidth: 300) // 设置宽度
            .frame(height: 400) // 调整高度，更加紧凑
            .zIndex(1000) // 确保弹窗在最上层
            .position(x: addPartState.partNumberInputFrame.minX + addPartState.partNumberInputFrame.width / 2, y: addPartState.partNumberInputFrame.maxY + 5) // 紧贴在型号输入框下方
            .eraseToAnyView()
        } else {
            return EmptyView().eraseToAnyView()
        }
    }
    
    var body: some View {
        // 背景
        Color(red: 0xF5/255, green: 0xF5/255, blue: 0xF5/255)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea()
        
        // 主容器
        GeometryReader { geometry in
            VStack(spacing: 0) {
                // 标题栏
                headerView
                
                // 滚动内容
                ZStack {
                    ScrollView {
                        VStack(spacing: 20) {
                            // 第一组：零件型号组
                            partNumberSection
                            
                            // 第二组：零件名称和颜色
                            partNameAndColorSection
                            
                            // 第三组：零件数量和重量计算
                            quantityAndWeightSection
                            
                            // 第四组：零件卡片
                            partCardView
                        }
                        .padding(15)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        // 点击滚动区域时，退出联想器
                        if addPartState.showNumberSuggestions {
                            print("点击滚动区域，退出联想器")
                            addPartState.showNumberSuggestions = false
                            addPartState.numberSuggestions = []
                        }
                    }
                    
                    // 零件型号联想建议弹窗 - 放在ZStack顶层
                    partNumberSuggestionPopup
                }
            }
        }
        .ignoresSafeArea(.keyboard) // 忽略键盘影响
        .sheet(isPresented: $addPartState.showColorPicker) {
            ColorPickerView(partNumber: addPartState.partNumber, onColorSelected: { selectedColorId in
                addPartState.colorInput = String(selectedColorId)
                fetchColorName(from: selectedColorId)
                // 关闭零件型号联想器
                addPartState.showNumberSuggestions = false
            }, source: .addPart)
        }
        .sheet(isPresented: $addPartState.showPartSelector) {
            PartSelectorView(selectedPartNumber: $addPartState.partNumber, selectedPartName: $addPartState.partName)
        }
    }
    
    // 获取临时零件对象（用于视图构建）
    private func getTempPartObject() -> NSManagedObject? {
        return addPartState.tempPartObject
    }
    
    private func fetchPartName(from partNumber: String) {
        // 清理零件型号，确保使用准确的型号
        let cleanPartNumber = partNumber.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        if cleanPartNumber.isEmpty {
            addPartState.partName = ""
            return
        }
        
        // 在后台线程执行数据库查询，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 创建私有上下文用于后台线程
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.rbContainer.viewContext
            
            var fetchedPartName: String? = nil
            
            privateContext.performAndWait {
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                fetchRequest.predicate = NSPredicate(format: "part_num == %@", cleanPartNumber)
                
                do {
                    let parts = try privateContext.fetch(fetchRequest)
                    if let part = parts.first {
                        fetchedPartName = part.value(forKey: "name") as? String
                    }
                } catch {
                    print("Error fetching part name: \(error)")
                }
            }
            
            // 在主线程更新UI
            if let partName = fetchedPartName {
                DispatchQueue.main.async {
                    self.addPartState.partName = partName
                }
            }
        }
    }
    
    private func fetchColorName(from colorId: Int32) {
        // 在后台线程执行数据库查询，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            // 从RB数据库获取颜色名称
            let persistence = PersistenceController.shared
            
            // 创建私有上下文用于后台线程
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.rbContainer.viewContext
            
            var fetchedColorName: String? = nil
            
            privateContext.performAndWait {
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                fetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
                
                do {
                    let colors = try privateContext.fetch(fetchRequest)
                    if let color = colors.first {
                        fetchedColorName = color.value(forKey: "name") as? String
                    }
                } catch {
                    print("Error fetching color name: \(error)")
                }
            }
            
            // 在主线程更新UI
            if let colorName = fetchedColorName {
                DispatchQueue.main.async {
                    self.addPartState.colorName = colorName
                }
            }
        }
    }
    
    private func getPartWeight() {
        guard !addPartState.partNumber.isEmpty else {
            addPartState.errorMessage = "请输入零件型号"
            return
        }
        
        addPartState.errorMessage = nil
        
        // 清理零件型号，确保使用准确的型号
        let cleanPartNumber = addPartState.partNumber.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        // 首先检查本地重量数据库
        if let localWeight = getLocalPartWeight(partNumber: cleanPartNumber) {
            addPartState.partWeight = localWeight
            addPartState.manualWeightInput = String(format: "%.2f", localWeight)
            print("从本地数据库获取重量成功: \(localWeight)g for \(cleanPartNumber)")
            return
        }
        
        // 使用Task来处理异步网络请求
        Task {
            print("从Bricklink获取重量...")
            let weight = await fetchBricklinkPartWeight(partNumber: cleanPartNumber)
            
            // 回到主线程更新UI
            DispatchQueue.main.async {
                if let weight = weight {
                    addPartState.partWeight = weight
                    addPartState.manualWeightInput = String(format: "%.2f", weight)
                    print("从Bricklink获取重量成功: \(weight)g for \(cleanPartNumber)")
                } else {
                    // 网络请求失败时，提供用户手动输入选项
                    addPartState.errorMessage = "无法从网络获取重量数据，请手动输入"
                    print("从Bricklink获取重量失败")
                }
            }
        }
    }
    
    private func fetchBricklinkPartWeight(partNumber: String) async -> Double? {
        // 尝试多次请求，最多重试3次
        for attempt in 1...3 {
            print("尝试获取Bricklink数据 (尝试 \(attempt)/3)...")
            
            // 使用Bricklink的商品页面URL
            let urlString = "https://www.bricklink.com/v2/catalog/catalogitem.page?P=\(partNumber)"
            guard let url = URL(string: urlString) else {
                print("无效的URL")
                continue
            }
            
            do {
                // 模拟网络请求延迟
                try await Task.sleep(nanoseconds: 1_000_000_000) // 1秒
                
                // 实际的网络请求代码
                let (data, response) = try await URLSession.shared.data(from: url)
                
                // 检查响应状态
                guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                    print("网络请求失败: 状态码错误")
                    continue
                }
                
                // 解析HTML内容
                guard let htmlString = String(data: data, encoding: .utf8) else {
                    print("无法解析HTML内容")
                    continue
                }
                
                // 从HTML中提取重量
                if let weight = extractWeight(from: htmlString) {
                    print("从Bricklink获取到重量: \(weight)g for \(partNumber)")
                    return weight
                } else {
                    print("无法从HTML中提取重量")
                    continue
                }
            } catch {
                print("网络请求失败: \(error)")
                continue
            }
        }
        
        return nil
    }
    
    private func extractWeight(from htmlString: String) -> Double? {
        print("开始从HTML中提取重量...")
        
        // 重点查找"Weight："关键字
        let weightPatterns = ["Weight：", "Weight:", "weight：", "weight:"]
        
        for pattern in weightPatterns {
            if let weightIndex = htmlString.range(of: pattern)?.lowerBound {
                // 从"Weight："位置开始，提取后面的内容
                let weightSubstring = htmlString[weightIndex...]
                print("找到'\(pattern)'，开始提取数字")
                
                // 查找第一个数字
                let numberPattern = #"\d+(\.\d+)?"#
                if let range = weightSubstring.range(of: numberPattern, options: .regularExpression) {
                    let weightString = String(weightSubstring[range])
                    print("提取到重量字符串: \(weightString)")
                    if let weight = Double(weightString) {
                        print("成功转换为重量: \(weight)g")
                        return weight
                    }
                }
            }
        }
        
        // 如果没找到，尝试其他方式
        print("未找到'Weight：'，尝试其他方式...")
        
        // 方式: 查找"g"（克）单位
        let gPattern = #"(\d+(\.\d+)?)\s*g"#
        if let range = htmlString.range(of: gPattern, options: .regularExpression) {
            let weightMatch = String(htmlString[range])
            print("找到'g'单位，提取到: \(weightMatch)")
            
            // 提取数字部分
            let numberPattern = #"\d+(\.\d+)?"#
            if let numberRange = weightMatch.range(of: numberPattern, options: .regularExpression) {
                let weightString = String(weightMatch[numberRange])
                print("提取到重量字符串: \(weightString)")
                if let weight = Double(weightString) {
                    print("成功转换为重量: \(weight)g")
                    return weight
                }
            }
        }
        
        print("无法从HTML中提取重量")
        return nil
    }
    
    private func getLocalPartWeight(partNumber: String) -> Double? {
        // 从本地数据库获取重量
        // 首先尝试从RB数据库获取
        let persistence = PersistenceController.shared
        let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
        rbPrivateContext.parent = persistence.rbContainer.viewContext
        
        var weight: Double? = nil
        
        rbPrivateContext.performAndWait { 
            let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
            fetchRequest.predicate = NSPredicate(format: "part_num == %@", partNumber)
            fetchRequest.fetchLimit = 1
            
            do {
                let parts = try rbPrivateContext.fetch(fetchRequest)
                if let part = parts.first {
                    // 检查Parts实体是否有weight属性
                    let entity = part.entity
                    if entity.attributesByName.keys.contains("weight") {
                        // 安全地获取weight属性
                        if let partWeight = part.value(forKey: "weight") as? Double {
                            weight = partWeight
                            print("从RB数据库获取到零件重量: \(partWeight)g for \(partNumber)")
                        } else {
                            print("RB数据库中的Parts实体有weight属性，但值为nil")
                        }
                    } else {
                        print("RB数据库中的Parts实体没有weight属性")
                    }
                }
            } catch {
                print("Error fetching part weight from RB database: \(error)")
            }
        }
        
        // 如果RB数据库中没有，尝试从系统数据库获取
        if weight == nil {
            let systemPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            systemPrivateContext.parent = persistence.container.viewContext
            
            systemPrivateContext.performAndWait { 
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                fetchRequest.predicate = NSPredicate(format: "part_num == %@", partNumber)
                fetchRequest.fetchLimit = 1
                
                do {
                    let parts = try systemPrivateContext.fetch(fetchRequest)
                    if let part = parts.first {
                        // 检查Part实体是否有weight属性
                        let entity = part.entity
                        if entity.attributesByName.keys.contains("weight") {
                            // 安全地获取weight属性
                            if let partWeight = part.value(forKey: "weight") as? Double {
                                weight = partWeight
                                print("从系统数据库获取到零件重量: \(partWeight)g for \(partNumber)")
                            } else {
                                print("系统数据库中的Part实体有weight属性，但值为nil")
                            }
                        } else {
                            print("系统数据库中的Part实体没有weight属性")
                        }
                    }
                } catch {
                    print("Error fetching part weight from system database: \(error)")
                }
            }
        }
        
        return weight
    }
    
    private func calculateQuantity() {
        guard !addPartState.weight.isEmpty, let totalWeight = Double(addPartState.weight) else {
            addPartState.errorMessage = "请输入有效的总重量"
            return
        }
        
        guard !addPartState.manualWeightInput.isEmpty, let partWeight = Double(addPartState.manualWeightInput) else {
            addPartState.errorMessage = "请先获取或设置零件重量"
            return
        }
        
        guard partWeight > 0 else {
            addPartState.errorMessage = "零件重量必须大于0"
            return
        }
        
        guard totalWeight > 0 else {
            addPartState.errorMessage = "总重量必须大于0"
            return
        }
        
        // 计算数量（四舍五入到整数）
        let calculatedQuantity = Int(round(totalWeight / partWeight))
        
        // 确保计算结果至少为1
        let finalQuantity = max(1, calculatedQuantity)
        addPartState.quantity = String(finalQuantity)
        
        // 打印调试信息
        print("数量计算结果:")
        print("  总重量: \(totalWeight) 克")
        print("  单个零件重量: \(partWeight) 克")
        print("  计算数量: \(calculatedQuantity)")
        print("  最终数量: \(finalQuantity)")
    }
    
    private func loadTempPartObject() {
        // 清理零件型号和颜色输入
        let cleanPartNumber = addPartState.partNumber.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let cleanColorInput = addPartState.colorInput.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let cleanQuantity = addPartState.quantity.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        // 只有当零件型号不为空时才执行加载操作
        guard !cleanPartNumber.isEmpty else {
            return
        }
        
        // 将数据库查询移到后台线程
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 创建私有上下文用于后台线程
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.rbContainer.viewContext
            
            // 从RB数据库获取零件名称
            var partName: String? = nil
            
            privateContext.performAndWait { 
                let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                partsFetchRequest.predicate = NSPredicate(format: "part_num == %@", cleanPartNumber)
                partsFetchRequest.fetchLimit = 1
                
                do {
                    let parts = try privateContext.fetch(partsFetchRequest)
                    if let part = parts.first {
                        partName = part.value(forKey: "name") as? String
                    }
                } catch {
                    print("Error fetching part name: \(error)")
                }
            }
            
            // 从RB数据库获取颜色名称
            var colorName: String? = nil
            if let colorId = Int32(cleanColorInput) {
                privateContext.performAndWait { 
                    let colorsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                    colorsFetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
                    colorsFetchRequest.fetchLimit = 1
                    
                    do {
                        let colors = try privateContext.fetch(colorsFetchRequest)
                        if let color = colors.first {
                            colorName = color.value(forKey: "name") as? String
                        }
                    } catch {
                        print("Error fetching color name: \(error)")
                    }
                }
            }
            
            // 设置颜色ID
            var tempPartColorId: Int32? = nil
            
            if let colorId = Int32(cleanColorInput) {
                tempPartColorId = colorId
            }
            
            // 处理数量
            let quantity = cleanQuantity.isEmpty ? 1 : (Int32(cleanQuantity) ?? 1)
            
            DispatchQueue.main.async {
                // 确保视图仍然存在
                // 使用临时上下文创建临时零件对象，避免修改主数据库
                let tempContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
                tempContext.parent = persistence.container.viewContext
                
                let tempManagedObject = NSEntityDescription.insertNewObject(forEntityName: "Part", into: tempContext)
                
                // 设置零件型号
                tempManagedObject.setValue(cleanPartNumber, forKey: "part_num")
                print("设置临时零件对象的part_num: \(cleanPartNumber)")
                
                // 设置零件名称（从RB数据库的Parts表获取）
                if let partName = partName {
                    tempManagedObject.setValue(partName, forKey: "name")
                    print("设置临时零件对象的name: \(partName)")
                    // 更新零件名称
                    self.addPartState.partName = partName
                    print("更新零件名称: \(partName)")
                } else {
                    // 如果没有从RB数据库获取到零件名称，使用输入的名称
                    tempManagedObject.setValue(self.addPartState.partName, forKey: "name")
                    print("设置临时零件对象的name: \(self.addPartState.partName)")
                }
                

                
                // 设置颜色ID
                if let colorId = tempPartColorId {
                    tempManagedObject.setValue(colorId, forKey: "color_id")
                    print("设置临时零件对象的color_id: \(colorId)")
                } else {
                    print("未设置临时零件对象的color_id")
                }
                
                // 设置数量，从输入框获取
                tempManagedObject.setValue(quantity, forKey: "quantity")
                print("设置临时零件对象的quantity: \(quantity)")
                
                // 更新颜色名称
                if let colorName = colorName {
                    self.addPartState.colorName = colorName
                    print("更新颜色名称: \(colorName)")
                }
                
                // 验证临时零件对象的属性
                let tempPartNum = tempManagedObject.value(forKey: "part_num") as? String
                let tempColorId = tempManagedObject.value(forKey: "color_id") as? Int32

                print("验证临时零件对象属性:")
                print("  part_num: \(tempPartNum ?? "nil")")
                print("  color_id: \(tempColorId ?? -1)")
                print("  color_name: \(colorName ?? "nil")")
                
                self.addPartState.tempPartObject = tempManagedObject
                print("临时零件对象已设置到addPartState.tempPartObject")
            }
        }
    }
    
    // 加载零件数据（名称、联想结果、临时零件对象）
    private func loadPartData(for partNumber: String, colorInput: String, quantity: String, showSuggestions: Bool = false) {
        // 清理输入
        let cleanPartNumber = partNumber.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let cleanColorInput = colorInput.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let cleanQuantity = quantity.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        // 只有当零件型号不为空时才执行加载操作
        guard !cleanPartNumber.isEmpty else {
            return
        }
        
        // 在后台线程执行所有数据库查询
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            
            // 创建私有上下文用于后台线程
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.rbContainer.viewContext
            
            // 1. 获取零件名称
            var partName: String? = nil
            
            privateContext.performAndWait { 
                let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                partsFetchRequest.predicate = NSPredicate(format: "part_num == %@", cleanPartNumber)
                partsFetchRequest.fetchLimit = 1
                
                do {
                    let parts = try privateContext.fetch(partsFetchRequest)
                    if let part = parts.first {
                        partName = part.value(forKey: "name") as? String
                    }
                } catch {
                    print("Error fetching part name: \(error)")
                }
            }
            
            // 2. 获取颜色名称
            var colorName: String? = nil
            var colorId: Int32? = nil
            
            if !cleanColorInput.isEmpty, let parsedColorId = Int32(cleanColorInput) {
                colorId = parsedColorId
                privateContext.performAndWait { 
                    let colorsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                    colorsFetchRequest.predicate = NSPredicate(format: "id == %d", parsedColorId)
                    colorsFetchRequest.fetchLimit = 1
                    
                    do {
                        let colors = try privateContext.fetch(colorsFetchRequest)
                        if let color = colors.first {
                            colorName = color.value(forKey: "name") as? String
                        }
                    } catch {
                        print("Error fetching color name: \(error)")
                    }
                }
            }
            
            // 3. 获取图片URL
            if let colorId = colorId {
                privateContext.performAndWait { 
                    let inventoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Inventory_parts")
                    inventoryFetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d", cleanPartNumber, colorId)
                    inventoryFetchRequest.fetchLimit = 1
                    
                    do {
                        let inventoryParts = try privateContext.fetch(inventoryFetchRequest)
                        if !inventoryParts.isEmpty {
                            // 图片URL将通过PartImageLoader直接获取
                        }
                    } catch {
                        print("Error fetching inventory part: \(error)")
                    }
                }
            }
            
            // 4. 获取联想结果 - 只有当showSuggestions为true时才执行
            if showSuggestions {
                PartNumberSuggestionManager.getSuggestionsAsync(for: cleanPartNumber, dataSource: .rb) { fetchedSuggestions in
                    DispatchQueue.main.async {
                        // 确保输入没有变化
                        if self.addPartState.partNumber.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) == cleanPartNumber {
                            self.addPartState.numberSuggestions = fetchedSuggestions
                            self.addPartState.showNumberSuggestions = !fetchedSuggestions.isEmpty
                        }
                    }
                }
            }
            
            // 5. 创建临时零件对象
            let quantityValue = cleanQuantity.isEmpty ? 1 : (Int32(cleanQuantity) ?? 1)
            
            DispatchQueue.main.async {
                // 使用临时上下文创建临时零件对象，避免修改主数据库
                let tempContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
                tempContext.parent = persistence.container.viewContext
                
                let tempManagedObject = NSEntityDescription.insertNewObject(forEntityName: "Part", into: tempContext)
                
                // 设置零件型号
                tempManagedObject.setValue(cleanPartNumber, forKey: "part_num")
                
                // 设置零件名称
                if let partName = partName {
                    tempManagedObject.setValue(partName, forKey: "name")
                    self.addPartState.partName = partName
                } else {
                    tempManagedObject.setValue(self.addPartState.partName, forKey: "name")
                }
                

                
                // 设置颜色ID
                if let colorId = colorId {
                    tempManagedObject.setValue(colorId, forKey: "color_id")
                }
                
                // 设置数量
                tempManagedObject.setValue(quantityValue, forKey: "quantity")
                
                // 更新颜色名称
                if let colorName = colorName {
                    self.addPartState.colorName = colorName
                }
                
                // 设置临时零件对象
                self.addPartState.tempPartObject = tempManagedObject
            }
        }
    }
    
    private func savePart() {
        // 验证输入
        // 清理输入
        let cleanPartNumber = addPartState.partNumber.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let cleanColorInput = addPartState.colorInput.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let cleanPartName = addPartState.partName.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        // 验证输入
        guard !cleanPartNumber.isEmpty else {
            addPartState.errorMessage = "请输入零件型号"
            return
        }
        
        guard !cleanColorInput.isEmpty else {
            addPartState.errorMessage = "请输入颜色"
            return
        }
        
        // 如果零件名称为空，尝试从RB数据库中获取
        var finalPartName = cleanPartName
        if finalPartName.isEmpty {
            let persistence = PersistenceController.shared
            let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
            fetchRequest.predicate = NSPredicate(format: "part_num == %@", cleanPartNumber)
            
            do {
                let parts = try persistence.rbContainer.viewContext.fetch(fetchRequest)
                if let part = parts.first, let partName = part.value(forKey: "name") as? String {
                    finalPartName = partName
                }
            } catch {
                print("Error fetching part name: \(error)")
            }
            
            // 如果仍然为空，提示用户输入
            guard !finalPartName.isEmpty else {
                addPartState.errorMessage = "请输入零件名称"
                return
            }
        }
        
        // 清理数量输入
        let cleanQuantity = addPartState.quantity.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        guard !cleanQuantity.isEmpty, let quantityValue = Int32(cleanQuantity) else {
            addPartState.errorMessage = "请输入有效的零件数量"
            return
        }
        
        guard quantityValue > 0 else {
            addPartState.errorMessage = "零件数量必须大于0"
            return
        }
        
        // 尝试将颜色输入转换为Int32
        guard let colorId = Int32(cleanColorInput) else {
            addPartState.errorMessage = "请输入有效的颜色ID"
            return
        }
        
        // 使用PersistenceController.shared.container.viewContext确保使用正确的上下文
        let persistence = PersistenceController.shared
        let saveContext = persistence.container.viewContext
        
        // 打印调试信息
        print("=== 开始保存零件 ===")
        print("  型号: \(cleanPartNumber)")
        print("  名称: \(finalPartName)")
        print("  颜色ID: \(colorId)")
        print("  是否新零件: \(addPartState.isNew)")
        print("  数量: \(quantityValue)")
        print("  盒子: \(box)")
        
        // 检查Part实体是否存在quantity属性
        let partEntity = NSEntityDescription.entity(forEntityName: "Part", in: saveContext)
        if let partEntity = partEntity {
            print("  Part实体属性: \(partEntity.attributesByName.keys)")
            if partEntity.attributesByName.keys.contains("quantity") {
                print("  ✓ Part实体包含quantity属性")
            } else {
                print("  ✗ Part实体不包含quantity属性")
            }
        }
        
        // 创建新零件
        let newPart = NSEntityDescription.insertNewObject(forEntityName: "Part", into: saveContext)
        
        // 先设置所有其他属性
        newPart.setValue(cleanPartNumber, forKey: "part_num")
        newPart.setValue(finalPartName, forKey: "name")
        newPart.setValue(colorId, forKey: "color_id")
        newPart.setValue(addPartState.isNew, forKey: "is_new")
        newPart.setValue(box, forKey: "box")
        
        // 专门处理quantity属性
        print("  尝试设置quantity值: \(quantityValue)")
        
        // 方法1: 使用setValue
        newPart.setValue(quantityValue, forKey: "quantity")
        
        // 验证设置结果
        if let setValue = newPart.value(forKey: "quantity") {
            print("  setValue结果: \(setValue) (类型: \(type(of: setValue)))")
        } else {
            print("  setValue失败: 未设置值")
        }
        
        // 尝试从RB数据库的Parts表中获取类别ID并设置到新零件
        print("  尝试获取类别ID")
        let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
        partsFetchRequest.predicate = NSPredicate(format: "part_num == %@", cleanPartNumber)
        partsFetchRequest.fetchLimit = 1
        
        do {
            let parts = try persistence.rbContainer.viewContext.fetch(partsFetchRequest)
            if let part = parts.first, let partCatId = part.value(forKey: "part_cat_id") as? Int32 {
                // 检查Part实体是否有part_cat_id属性
                if let partEntity = NSEntityDescription.entity(forEntityName: "Part", in: saveContext) {
                    if partEntity.attributesByName.keys.contains("part_cat_id") {
                        newPart.setValue(partCatId, forKey: "part_cat_id")
                        print("  成功设置类别ID: \(partCatId)")
                    } else {
                        print("  Part实体不包含part_cat_id属性")
                    }
                }
            } else {
                print("  未找到类别ID")
            }
        } catch {
            print("  获取类别ID失败: \(error)")
        }
        
        // 尝试从RB数据库的inventory_parts表中获取图片URL并设置到新零件
        print("  尝试获取图片URL")
        let inventoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Inventory_parts")
        inventoryFetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d", cleanPartNumber, colorId)
        

        
        // 保存到数据库
        do {
            try saveContext.save()
            print("零件保存成功")
            
            // 归并重复零件
            mergeDuplicateParts(in: saveContext)
            
            // 保存成功后，返回零件管理页面
            currentState = .partManagement(box)
        } catch {
            print("零件保存失败: \(error)")
            addPartState.errorMessage = "保存失败: \(error.localizedDescription)"
        }
    }
    
    // 归并相同型号、颜色和新旧状态的零件，数量叠加
    private func mergeDuplicateParts(in context: NSManagedObjectContext) {
        print("开始归并重复零件...")
        
        // 获取所有零件
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        var allParts: [NSManagedObject] = []
        
        do {
            allParts = try context.fetch(fetchRequest)
            print("获取到 \(allParts.count) 个零件")
        } catch {
            print("获取零件失败: \(error)")
            return
        }
        
        // 按型号、颜色、新旧状态和盒子分组
        var partGroups: [String: [NSManagedObject]] = [:]
        
        for part in allParts {
            let partNum = part.value(forKey: "part_num") as? String ?? ""
            let colorId = part.value(forKey: "color_id") as? Int32 ?? 0
            let isNew = part.value(forKey: "is_new") as? Bool ?? false
            
            // 获取零件所属的盒子
            var boxId: Int32 = -1
            if let partBox = part.value(forKey: "box") as? NSManagedObject {
                boxId = partBox.value(forKey: "id") as? Int32 ?? -1
            }
            
            // 生成唯一的分组键，包含型号、颜色、状态和盒子ID
            let groupKey = "\(partNum)-\(colorId)-\(isNew)-\(boxId)"
            
            if var group = partGroups[groupKey] {
                group.append(part)
                partGroups[groupKey] = group
            } else {
                partGroups[groupKey] = [part]
            }
        }
        
        print("共分为 \(partGroups.count) 组零件")
        
        // 对每组零件进行归并
        var mergedCount = 0
        var deletedCount = 0
        
        for (key, parts) in partGroups {
            if parts.count > 1 {
                // 保留第一个零件
                let mainPart = parts[0]
                var totalQuantity: Int32 = mainPart.value(forKey: "quantity") as? Int32 ?? 0
                
                // 累加其他零件的数量
                for i in 1..<parts.count {
                    let part = parts[i]
                    let partQuantity = part.value(forKey: "quantity") as? Int32 ?? 0
                    totalQuantity += partQuantity
                    
                    // 删除多余的零件
                    context.delete(part)
                    deletedCount += 1
                }
                
                // 更新主零件的数量
                mainPart.setValue(totalQuantity, forKey: "quantity")
                mergedCount += 1
                print("归并组 \(key): 从 \(parts.count) 个零件合并为 1 个，总数量: \(totalQuantity)")
            }
        }
        
        // 保存上下文
        do {
            try context.save()
            print("归并操作完成: 归并了 \(mergedCount) 组，删除了 \(deletedCount) 个零件")
        } catch {
            print("保存归并结果失败: \(error)")
        }
    }
}
